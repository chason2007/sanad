'use server';

import { revalidatePath } from 'next/cache';
import { requireWriteAccess } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { isValidIsoDate } from '@/lib/dates';
import { nullifyEmpty, nullifySelect, requiredString } from '@/lib/utils';
import { REVIEW_THRESHOLD } from '@/lib/extraction/schema';
import type { HolderType } from '@/lib/types';
import type { ActionResult } from '@/app/actions/documents';
import { checkCanAddDocument } from '@/lib/billing-server';

/**
 * Turn a reviewed extraction job into a real document.
 *
 * This is the only path from "the model read something" to "a row that can
 * fire an alert", and it runs only when a human has confirmed the dates on
 * screen. Nothing here trusts the model output that arrived earlier: every
 * field is re-read from what the user actually submitted.
 */
export async function confirmExtraction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();

    const limit = await checkCanAddDocument(session);
    if (!limit.allowed) return { ok: false, error: limit.message };

    const supabase = createClient();

    const jobId = requiredString(formData.get('job_id'), 'Extraction job');
    const entityId = requiredString(formData.get('entity_id'), 'Entity');
    const documentTypeId = requiredString(formData.get('document_type_id'), 'Document type');
    const expiryDate = requiredString(formData.get('expiry_date'), 'Expiry date');
    const issueDate = nullifyEmpty(formData.get('issue_date'));

    if (!isValidIsoDate(expiryDate)) return { ok: false, error: 'Enter the expiry date as YYYY-MM-DD.' };
    if (issueDate && !isValidIsoDate(issueDate)) return { ok: false, error: 'Enter the issue date as YYYY-MM-DD.' };
    if (issueDate && issueDate > expiryDate) {
      return { ok: false, error: 'The issue date cannot be after the expiry date.' };
    }

    const { data: job, error: jobError } = await supabase
      .from('extraction_jobs').select('*').eq('id', jobId).maybeSingle();

    if (jobError) return { ok: false, error: jobError.message };
    if (!job) return { ok: false, error: 'That upload is no longer available.' };
    if (job.document_id) return { ok: false, error: 'This upload has already been saved.' };

    // ---- resolve the holder: existing, new, or none ----
    let holderId = nullifySelect(formData.get('holder_id'));
    const newHolderName = nullifyEmpty(formData.get('new_holder_name'));

    if (!holderId && newHolderName) {
      const holderType = (nullifyEmpty(formData.get('new_holder_type')) ?? 'employee') as HolderType;
      const { data: holder, error: holderError } = await supabase
        .from('holders')
        .insert({
          entity_id: entityId,
          holder_type: holderType,
          name: newHolderName,
          identifier: nullifyEmpty(formData.get('new_holder_identifier')),
        })
        .select('id')
        .single();

      if (holderError) return { ok: false, error: holderError.message };
      holderId = holder.id;

      await recordAudit(supabase, {
        orgId: session.organization.id,
        actorUserId: session.userId,
        action: 'holder.created',
        targetTable: 'holders',
        targetId: holder.id,
        metadata: { name: newHolderName, created_via: 'upload' },
      });
    }

    const confidence = Number(job.confidence ?? 0);

    const { data: document, error: insertError } = await supabase
      .from('documents')
      .insert({
        entity_id: entityId,
        holder_id: holderId,
        document_type_id: documentTypeId,
        document_number: nullifyEmpty(formData.get('document_number')),
        issue_date: issueDate,
        expiry_date: expiryDate,
        responsible_user_id: nullifyEmpty(formData.get('responsible_user_id')) ?? session.userId,
        notes: nullifyEmpty(formData.get('notes')),
        file_path: job.file_path,
        // Keep the flag on the row when the read was shaky, so the register
        // still shows it as worth a second look even after confirmation.
        needs_review: confidence < REVIEW_THRESHOLD,
      })
      .select('id')
      .single();

    if (insertError) return { ok: false, error: insertError.message };

    // Move the file out of the staging prefix now that it has an owner.
    if (job.file_path) {
      const filename = job.file_path.split('/').pop();
      const destination = `${session.organization.id}/${entityId}/${document.id}/${filename}`;
      const { error: moveError } = await supabase.storage
        .from('documents').move(job.file_path, destination);

      if (!moveError) {
        await supabase.from('documents').update({ file_path: destination }).eq('id', document.id);
      }
      // A failed move is cosmetic - the staged path still resolves - so it
      // must not undo a document the user just confirmed.
    }

    await supabase
      .from('extraction_jobs')
      .update({ document_id: document.id, status: 'succeeded' })
      .eq('id', jobId);

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'extraction.completed',
      targetTable: 'documents',
      targetId: document.id,
      metadata: {
        job_id: jobId,
        confidence,
        expiry_date: expiryDate,
        corrected: job.raw_response ? wasCorrected(job.raw_response, expiryDate) : null,
      },
    });

    revalidatePath('/', 'layout');
    return { ok: true, documentId: document.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Did the user change the date the model proposed?
 *
 * Recorded on every confirmation. Over a few thousand uploads this is the
 * only honest measure of how good extraction actually is, and it is the
 * number that should decide whether the prompt or the model needs work.
 */
function wasCorrected(raw: unknown, finalExpiry: string): boolean | null {
  try {
    const parsed = (raw as { parsed_output?: { expiry_date?: string } })?.parsed_output;
    if (!parsed?.expiry_date) return null;
    return parsed.expiry_date !== finalExpiry;
  } catch {
    return null;
  }
}

/** Drop a staged upload the user decided against. */
export async function discardExtraction(jobId: string): Promise<ActionResult> {
  try {
    await requireWriteAccess();
    const supabase = createClient();

    const { data: job } = await supabase
      .from('extraction_jobs').select('file_path, document_id').eq('id', jobId).maybeSingle();

    if (job?.document_id) return { ok: false, error: 'That upload has already been saved.' };

    if (job?.file_path) {
      await supabase.storage.from('documents').remove([job.file_path]);
    }
    await supabase.from('extraction_jobs').delete().eq('id', jobId);

    revalidatePath('/upload');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Short-lived signed URL for a staged file, so the review screen can show
 * the scan next to the fields the model read off it. Same 60-second expiry
 * and same role gate as any other file in the system.
 */
export async function getStagedFileUrl(jobId: string): Promise<ActionResult> {
  try {
    await requireWriteAccess();
    const supabase = createClient();

    const { data: job } = await supabase
      .from('extraction_jobs').select('file_path').eq('id', jobId).maybeSingle();

    if (!job?.file_path) return { ok: false, error: 'No file is attached to this upload.' };

    const { data, error } = await supabase.storage
      .from('documents').createSignedUrl(job.file_path, 60);

    if (error || !data) return { ok: false, error: error?.message ?? 'Could not open that file.' };
    return { ok: true, url: data.signedUrl };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
