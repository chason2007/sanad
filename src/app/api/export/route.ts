import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { createZip, zipSafeName, type ZipEntry } from '@/lib/zip';
import { toCsv } from '@/lib/register';
import { dubaiToday } from '@/lib/dates';
import { log } from '@/lib/privacy';
import { DATA_RESIDENCY } from '@/lib/residency';
import type { RegisterRow } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Stop pulling files before the function is killed mid-stream. */
const SOFT_DEADLINE_MS = 45_000;
/** Cap the archive so one export cannot exhaust memory. */
const MAX_FILE_BYTES = 150 * 1024 * 1024;

/**
 * GET /api/export - "export all my data".
 *
 * Everything the organisation owns, in one archive: every table as both
 * JSON and CSV, and every stored scan. Owner only, because the archive
 * contains every passport and Emirates ID in the account and the role that
 * can see all of that is the one accountable for it.
 *
 * Built before launch rather than after, because a data subject access
 * request with no tooling behind it becomes a fortnight of somebody running
 * SQL by hand and pasting results into a spreadsheet - which is both slower
 * and less accurate than doing it properly once.
 */
export async function GET() {
  let session;
  try {
    session = await requireRole('owner');
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 403 });
  }

  const started = Date.now();
  const supabase = createClient();
  const org = session.organization;
  const today = dubaiToday();

  const [
    entities, holders, documents, documentTypes, alertRules,
    alerts, extractionJobs, auditLog, profiles,
  ] = await Promise.all([
    supabase.from('entities').select('*'),
    supabase.from('holders').select('*'),
    supabase.from('document_register').select('*'),
    supabase.from('document_types').select('*').not('org_id', 'is', null),
    supabase.from('alert_rules').select('*'),
    supabase.from('alerts').select('*'),
    supabase.from('extraction_jobs').select('*'),
    supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(10_000),
    supabase.from('profiles').select('*'),
  ]);

  const rows = (documents.data ?? []) as RegisterRow[];
  const entries: ZipEntry[] = [];

  const json = (name: string, data: unknown) =>
    entries.push({ path: `data/${name}.json`, data: JSON.stringify(data ?? [], null, 2) });

  json('organization', org);
  json('people', profiles.data);
  json('companies', entities.data);
  json('holders', holders.data);
  json('documents', rows);
  json('document_types_custom', documentTypes.data);
  json('reminder_rules', alertRules.data);
  json('reminders_sent', alerts.data);
  json('extraction_jobs', extractionJobs.data);
  json('audit_log', auditLog.data);

  // CSV of the register too: this is the format the customer arrived with
  // and the one they can actually open.
  entries.push({ path: 'register.csv', data: toCsv(rows) });

  // ---- the scans themselves ----
  const entityNames = new Map(
    ((entities.data ?? []) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]),
  );

  const withFiles = rows.filter((r) => r.file_path);
  let bytes = 0;
  let included = 0;
  const omitted: string[] = [];

  for (const row of withFiles) {
    if (Date.now() - started > SOFT_DEADLINE_MS || bytes > MAX_FILE_BYTES) {
      omitted.push(row.id);
      continue;
    }
    try {
      const { data, error } = await supabase.storage.from('documents').download(row.file_path!);
      if (error || !data) { omitted.push(row.id); continue; }

      const buf = Buffer.from(await data.arrayBuffer());
      bytes += buf.byteLength;

      const ext = row.file_path!.split('.').pop()?.toLowerCase() ?? 'bin';
      const folder = zipSafeName(entityNames.get(row.entity_id) ?? 'company');
      const label = zipSafeName(
        `${row.holder_name ?? 'company'}-${row.document_type_label}-${row.expiry_date}`,
      );
      entries.push({ path: `files/${folder}/${label}-${row.id.slice(0, 8)}.${ext}`, data: buf });
      included += 1;
    } catch (err) {
      log.error('export', 'could not read a stored file', err);
      omitted.push(row.id);
    }
  }

  entries.push({
    path: 'README.txt',
    data: [
      `Sanad data export`,
      `Organisation: ${org.name}`,
      `Generated:    ${today} (Asia/Dubai)`,
      ``,
      `WHAT IS IN HERE`,
      `  data/*.json   every record this organisation owns, one file per table`,
      `  register.csv  the document register, openable in Excel`,
      `  files/        every uploaded scan, foldered by company`,
      ``,
      `  Scans included: ${included} of ${withFiles.length}`,
      omitted.length
        ? `  ${omitted.length} were omitted for size or a read error. Re-run the export to collect them.`
        : `  All stored scans are included.`,
      ``,
      `HANDLE WITH CARE`,
      `  This archive contains passport, visa and Emirates ID scans and the`,
      `  personal data extracted from them. It is not encrypted. Store it`,
      `  somewhere appropriate and delete it when you are done.`,
      ``,
      `WHERE YOUR DATA NORMALLY LIVES`,
      `  ${DATA_RESIDENCY.summary}`,
      ``,
      `Retention: superseded scans are purged after ${org.data_retention_days} days.`,
      `The register row is kept; only the image and extracted personal data go.`,
    ].join('\n'),
  });

  let archive: Buffer;
  try {
    archive = createZip(entries);
  } catch (err) {
    log.error('export', 'could not build the archive', err);
    return NextResponse.json({ error: 'Could not build the export.' }, { status: 500 });
  }

  await recordAudit(supabase, {
    orgId: org.id,
    actorUserId: session.userId,
    action: 'report.generated',
    metadata: {
      kind: 'data_export',
      tables: 10,
      documents: rows.length,
      files_included: included,
      files_omitted: omitted.length,
      bytes: archive.byteLength,
    },
  });

  const filename = `sanad-export-${zipSafeName(org.name)}-${today}.zip`;

  // Uint8Array view: NextResponse takes a BodyInit, and Buffer is not one.
  return new NextResponse(new Uint8Array(archive), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
