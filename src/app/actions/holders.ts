'use server';

import { revalidatePath } from 'next/cache';
import { requireWriteAccess } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { nullifyEmpty, requiredString } from '@/lib/utils';
import { HOLDER_TYPES, type HolderType } from '@/lib/types';
import type { ActionResult } from '@/app/actions/documents';

function parseHolderType(value: FormDataEntryValue | null): HolderType {
  const raw = nullifyEmpty(value);
  return HOLDER_TYPES.includes(raw as HolderType) ? (raw as HolderType) : 'employee';
}

export async function createHolder(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();
    const supabase = createClient();

    const entityId = requiredString(formData.get('entity_id'), 'Company');
    const name = requiredString(formData.get('name'), 'Name');

    const { data, error } = await supabase
      .from('holders')
      .insert({
        entity_id: entityId,
        holder_type: parseHolderType(formData.get('holder_type')),
        name,
        identifier: nullifyEmpty(formData.get('identifier')),
      })
      .select('id')
      .single();

    if (error) return { ok: false, error: error.message };

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'holder.created',
      targetTable: 'holders',
      targetId: data.id,
      metadata: { name },
    });

    revalidatePath('/holders');
    return { ok: true, documentId: data.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function updateHolder(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();
    const supabase = createClient();

    const holderId = requiredString(formData.get('holder_id'), 'Holder');
    const name = requiredString(formData.get('name'), 'Name');

    const { error } = await supabase
      .from('holders')
      .update({
        name,
        holder_type: parseHolderType(formData.get('holder_type')),
        identifier: nullifyEmpty(formData.get('identifier')),
        active: formData.get('active') === 'on' || formData.get('active') === 'true',
      })
      .eq('id', holderId);

    if (error) return { ok: false, error: error.message };

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'holder.updated',
      targetTable: 'holders',
      targetId: holderId,
      metadata: { name },
    });

    revalidatePath('/holders');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface BulkHolderResult extends ActionResult {
  created?: number;
  skipped?: string[];
}

/**
 * Bulk-add holders from pasted CSV or tab-separated text.
 *
 * The onboarding path for someone arriving with a spreadsheet: they select
 * a column block in Excel, paste it here, and it works. Accepts commas or
 * tabs, tolerates a header row, and reports which lines it could not read
 * rather than silently dropping them - a silent drop during onboarding is
 * how someone ends up trusting a register that is missing four people.
 */
export async function bulkCreateHolders(
  entityId: string,
  text: string,
  defaultType: HolderType = 'employee',
): Promise<BulkHolderResult> {
  try {
    const session = await requireWriteAccess();
    const supabase = createClient();

    if (!entityId) return { ok: false, error: 'Choose a company first.' };

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { ok: false, error: 'Nothing to add.' };

    const skipped: string[] = [];
    const rows: Array<{ entity_id: string; holder_type: HolderType; name: string; identifier: string | null }> = [];

    for (const [index, line] of lines.entries()) {
      const cells = line.split(/\t|,/).map((c) => c.trim().replace(/^"|"$/g, ''));
      const [name, identifier, typeRaw] = cells;

      if (!name) { skipped.push(`Line ${index + 1}: no name`); continue; }

      // Tolerate an Excel header row without making the user delete it.
      if (index === 0 && /^(name|full name|employee|holder)$/i.test(name)) continue;

      const type = HOLDER_TYPES.includes(typeRaw as HolderType)
        ? (typeRaw as HolderType)
        : defaultType;

      rows.push({
        entity_id: entityId,
        holder_type: type,
        name,
        identifier: identifier || null,
      });
    }

    if (!rows.length) {
      return { ok: false, error: 'No usable rows found.', skipped };
    }

    const { error } = await supabase.from('holders').insert(rows);
    if (error) return { ok: false, error: error.message, skipped };

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'holder.created',
      targetTable: 'holders',
      metadata: { count: rows.length, method: 'bulk_paste' },
    });

    revalidatePath('/holders');
    return { ok: true, created: rows.length, skipped };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
