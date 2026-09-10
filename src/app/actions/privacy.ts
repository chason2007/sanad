'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, requireWriteAccess } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAudit } from '@/lib/audit';
import { log } from '@/lib/privacy';
import { requiredString } from '@/lib/utils';
import type { ActionResult } from '@/app/actions/documents';

/**
 * Set how long superseded scans are kept.
 *
 * The floor of 30 days is enforced by a check constraint as well as here -
 * an organisation should not be able to configure itself into destroying
 * evidence of a renewal it made this morning.
 */
export async function updateRetention(days: number): Promise<ActionResult> {
  try {
    const session = await requireRole('owner');

    if (!Number.isInteger(days) || days < 30 || days > 3650) {
      return { ok: false, error: 'Choose between 30 days and 10 years.' };
    }

    const supabase = createClient();
    const { error } = await supabase
      .from('organizations')
      .update({ data_retention_days: days })
      .eq('id', session.organization.id);

    if (error) return { ok: false, error: error.message };

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'org.created',
      targetTable: 'organizations',
      targetId: session.organization.id,
      metadata: { change: 'data_retention_days', from: session.organization.data_retention_days, to: days },
    });

    revalidatePath('/settings/privacy');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface DeleteOrgResult extends ActionResult {
  filesDeleted?: number;
  usersDeleted?: number;
}

/**
 * Delete the organisation and everything in it. Irreversible.
 *
 * Order matters. Storage objects go FIRST, because once the rows are gone
 * nothing remembers which objects belonged to this tenant and the scans
 * would sit in the bucket forever, unreferenced and undeletable - the exact
 * opposite of an erasure request.
 *
 * The database function then removes every row by cascade, including the
 * audit log and the auth users. Keeping an audit trail about a tenant you
 * were asked to forget defeats the request, so it goes too.
 */
export async function deleteOrganization(formData: FormData): Promise<DeleteOrgResult> {
  try {
    const session = await requireRole('owner');
    const confirmation = requiredString(formData.get('confirm_name'), 'Company name');

    if (confirmation !== session.organization.name) {
      return { ok: false, error: 'That name does not match. Nothing was deleted.' };
    }

    const supabase = createClient();
    const orgId = session.organization.id;

    // ---- 1. every stored scan, including staged uploads never confirmed ----
    const admin = createAdminClient();
    let filesDeleted = 0;

    try {
      // The org id is the first path segment, so one listing covers the
      // whole tenant regardless of how the objects were created.
      const paths: string[] = [];
      const { data: docs } = await supabase.from('documents').select('file_path').not('file_path', 'is', null);
      const { data: jobs } = await supabase.from('extraction_jobs').select('file_path').not('file_path', 'is', null);

      for (const row of [...(docs ?? []), ...(jobs ?? [])] as Array<{ file_path: string }>) {
        if (row.file_path?.startsWith(`${orgId}/`)) paths.push(row.file_path);
      }

      const unique = [...new Set(paths)];
      for (let i = 0; i < unique.length; i += 100) {
        const batch = unique.slice(i, i + 100);
        const { error } = await admin.storage.from('documents').remove(batch);
        if (error) {
          log.error('erasure', 'could not remove a batch of files', { error: error.message });
        } else {
          filesDeleted += batch.length;
        }
      }
    } catch (err) {
      log.error('erasure', 'file cleanup failed', err);
      return {
        ok: false,
        error: 'Could not remove the stored files, so nothing was deleted. Please try again.',
      };
    }

    // ---- 2. every row, via the definer function ----
    const { data: usersDeleted, error } = await supabase.rpc('delete_own_organization', {
      p_confirm_name: confirmation,
    });

    if (error) return { ok: false, error: error.message };

    log.info('erasure', 'organization deleted', {
      files_deleted: filesDeleted,
      users_deleted: usersDeleted,
    });

    return { ok: true, filesDeleted, usersDeleted: Number(usersDeleted ?? 0) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Count what an erasure would destroy, so the warning is specific. */
export async function describeErasure(): Promise<{
  documents: number; files: number; holders: number; people: number; entities: number;
}> {
  await requireWriteAccess();
  const supabase = createClient();

  const [documents, files, holders, people, entities] = await Promise.all([
    supabase.from('documents').select('id', { count: 'exact', head: true }),
    supabase.from('documents').select('id', { count: 'exact', head: true }).not('file_path', 'is', null),
    supabase.from('holders').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('entities').select('id', { count: 'exact', head: true }),
  ]);

  return {
    documents: documents.count ?? 0,
    files: files.count ?? 0,
    holders: holders.count ?? 0,
    people: people.count ?? 0,
    entities: entities.count ?? 0,
  };
}
