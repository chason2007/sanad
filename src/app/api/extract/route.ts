import { NextResponse, type NextRequest } from 'next/server';
import { requireWriteAccess } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { extractDocumentFields } from '@/lib/extraction/extract';
import { REVIEW_THRESHOLD } from '@/lib/extraction/schema';
import type { DocumentType } from '@/lib/types';

export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
];

/**
 * POST /api/extract
 *
 * Takes one uploaded file, stores it, asks the model to read the compliance
 * fields off it, and returns them for the user to confirm. It deliberately
 * does NOT create a document row - see the staged-extractions migration for
 * why nothing un-reviewed is allowed near the alert engine.
 *
 * A failure here is never fatal. The staged job is still created with the
 * file attached, so the user lands on the review screen with an empty form
 * and types the date in themselves.
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireWriteAccess();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 403 });
  }

  const supabase = createClient();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart upload.' }, { status: 400 });
  }

  const file = form.get('file');
  const entityId = String(form.get('entity_id') || '');

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No file was attached.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 15 MB.' }, { status: 400 });
  }
  if (!ACCEPTED.includes(file.type)) {
    return NextResponse.json(
      { error: `Sanad reads PDFs and images. ${file.type || 'That file type'} is not supported.` },
      { status: 400 },
    );
  }

  // Confirm the entity belongs to the caller's org. RLS would refuse the
  // write anyway, but failing here gives a clearer error than a policy
  // violation surfacing three steps later.
  const { data: entity } = await supabase
    .from('entities').select('id').eq('id', entityId).maybeSingle();

  if (!entity) {
    return NextResponse.json({ error: 'Choose which company this document belongs to.' }, { status: 400 });
  }

  // ---- store the file first, so a model failure never loses the upload ----
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
  const key = `${session.organization.id}/${entityId}/staged/${Date.now()}-${safeName}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(key, bytes, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: `Could not store the file: ${uploadError.message}` }, { status: 500 });
  }

  const { data: types } = await supabase
    .from('document_types').select('code, label').order('label');

  const documentTypes = ((types ?? []) as Pick<DocumentType, 'code' | 'label'>[]).map((t) => ({
    code: t.code, label: t.label,
  }));

  const outcome = await extractDocumentFields({
    data: bytes,
    mediaType: file.type,
    documentTypes,
  });

  // Persist the job whatever happened - the raw response is the only way to
  // debug a bad read after the fact.
  const { data: job, error: jobError } = await supabase
    .from('extraction_jobs')
    .insert({
      document_id: null,
      org_id: session.organization.id,
      entity_id: entityId,
      status: outcome.status,
      raw_response: safeRaw(outcome.raw),
      confidence: outcome.confidence,
      warnings: outcome.warnings,
      model: outcome.model,
      error: outcome.error,
      file_path: key,
      file_name: file.name,
      mime_type: file.type,
      created_by: session.userId,
    })
    .select('id')
    .single();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  return NextResponse.json({
    job_id: job.id,
    status: outcome.status,
    confidence: outcome.confidence,
    warnings: outcome.warnings,
    error: outcome.error,
    needs_review: outcome.confidence < REVIEW_THRESHOLD,
    file_name: file.name,
    fields: outcome.payload
      ? {
          document_type_code: outcome.payload.document_type_code,
          document_number: outcome.payload.document_number,
          holder_name: outcome.payload.holder_name,
          issue_date: outcome.payload.issue_date,
          expiry_date: outcome.payload.expiry_date,
          reasoning: outcome.payload.reasoning,
        }
      : null,
  });
}

/**
 * The SDK response object carries the full request context. Keep the parts
 * worth debugging and drop the rest so the audit trail does not quietly
 * accumulate base64 copies of every passport scan uploaded.
 */
function safeRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  return {
    id: r.id,
    model: r.model,
    stop_reason: r.stop_reason,
    usage: r.usage,
    parsed_output: r.parsed_output,
    content: r.content,
  };
}
