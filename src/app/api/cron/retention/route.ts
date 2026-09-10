import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { dubaiToday } from '@/lib/dates';
import { recordAudit } from '@/lib/audit';
import { log } from '@/lib/privacy';
import type { Organization } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SOFT_DEADLINE_MS = 50_000;
const BATCH = 500;

/**
 * POST /api/cron/retention - purge superseded scans past their retention.
 *
 * What this deletes and what it keeps is the whole point:
 *
 *   deleted  the stored file (a passport / visa / Emirates ID image), and
 *            the extracted personal data sitting in extraction_jobs
 *   kept     the document row - dates, type, holder link, renewal chain
 *
 * An auditor asking "what did this licence look like three renewals ago"
 * is answered by the row. Nobody needs the image of somebody's passport to
 * answer it, and under PDPL keeping it once it has served its purpose is
 * the thing you cannot justify.
 *
 * Retention is per organisation (organizations.data_retention_days), floor
 * of 30 days enforced by a check constraint so this can never be turned
 * into an instant-shredder.
 *
 * ?dry_run=true reports what it would purge and touches nothing.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if ((auth.startsWith('Bearer ') ? auth.slice(7) : '') !== secret) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dry_run') === 'true';
  const now = new Date();

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const { data: orgs, error: orgError } = await supabase.from('organizations').select('*');
  if (orgError) {
    return NextResponse.json({ error: 'Could not load organizations.' }, { status: 500 });
  }

  const report: Array<Record<string, unknown>> = [];
  let filesDeleted = 0;
  let documentsArchived = 0;
  let extractionsPurged = 0;

  for (const org of (orgs ?? []) as Organization[]) {
    if (Date.now() - started > SOFT_DEADLINE_MS) {
      report.push({ org: org.name, skipped: 'ran out of time; next run continues' });
      continue;
    }

    const retentionDays = org.data_retention_days ?? 365;
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();

    // Keyed off superseded_at, not updated_at. updated_at is maintained by
    // a trigger and moves on every edit, so it would restart the retention
    // clock each time somebody corrected a typo on an old document.
    const { data: stale, error } = await supabase
      .from('document_register')
      .select('id, file_path, superseded_at, status')
      .eq('org_id', org.id)
      .not('superseded_by_id', 'is', null)
      .lte('superseded_at', cutoff)
      .limit(BATCH);

    if (error) {
      log.error('retention', 'could not query stale documents', { error: error.message });
      continue;
    }

    const rows = stale ?? [];
    const withFiles = rows.filter((r: any) => r.file_path);

    if (!rows.length) continue;

    if (dryRun) {
      report.push({
        org: org.name,
        retention_days: retentionDays,
        superseded_before: cutoff.slice(0, 10),
        documents_to_archive: rows.length,
        files_to_delete: withFiles.length,
      });
      continue;
    }

    // 1. Remove the scans. Storage first: if this fails we keep the row
    //    pointing at the file rather than orphaning an image nobody can
    //    find but that still exists in the bucket.
    const paths = withFiles.map((r: any) => r.file_path as string);
    if (paths.length) {
      const { error: removeError } = await supabase.storage.from('documents').remove(paths);
      if (removeError) {
        log.error('retention', 'storage purge failed', { org_id: org.id, error: removeError.message });
        continue;
      }
      filesDeleted += paths.length;
    }

    const ids = rows.map((r: any) => r.id as string);

    // 2. Drop the pointer and archive the row.
    const { error: updateError } = await supabase
      .from('documents')
      .update({ file_path: null, status: 'archived' })
      .in('id', ids);

    if (updateError) {
      log.error('retention', 'could not archive documents', { error: updateError.message });
      continue;
    }
    documentsArchived += ids.length;

    // 3. Purge extracted personal data. raw_response holds the holder name
    //    and document number the model read off the scan; keeping that
    //    after the scan itself is gone would defeat the exercise.
    const { data: purged } = await supabase
      .from('extraction_jobs')
      .update({ raw_response: null, warnings: [] })
      .in('document_id', ids)
      .not('raw_response', 'is', null)
      .select('id');

    extractionsPurged += purged?.length ?? 0;

    await recordAudit(supabase, {
      orgId: org.id,
      actorUserId: null,
      action: 'document.archived',
      metadata: {
        reason: 'retention',
        retention_days: retentionDays,
        documents: ids.length,
        files_deleted: paths.length,
        extractions_purged: purged?.length ?? 0,
      },
    });

    report.push({
      org: org.name,
      retention_days: retentionDays,
      documents_archived: ids.length,
      files_deleted: paths.length,
      extractions_purged: purged?.length ?? 0,
    });
  }

  return NextResponse.json({
    dry_run: dryRun,
    dubai_today: dubaiToday(now),
    organizations: (orgs ?? []).length,
    documents_archived: documentsArchived,
    files_deleted: filesDeleted,
    extractions_purged: extractionsPurged,
    report,
    took_ms: Date.now() - started,
  });
}

/** Vercel Cron invokes with GET; the bearer token is the gate either way. */
export async function GET(request: NextRequest) {
  return POST(request);
}
