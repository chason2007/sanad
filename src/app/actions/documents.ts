'use server';

import { revalidatePath } from 'next/cache';
import { requireWriteAccess, requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { isValidIsoDate } from '@/lib/dates';
import { nullifyEmpty, nullifySelect, requiredString } from '@/lib/utils';
import { canDownloadFiles } from '@/lib/types';

export interface ActionResult {
  ok: boolean;
  error?: string;
  documentId?: string;
  url?: string;
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/** Object key convention: the first segment is the tenant boundary. */
function storageKey(orgId: string, entityId: string, documentId: string, filename: string) {
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-120);
  return `${orgId}/${entityId}/${documentId}/${Date.now()}-${safe}`;
}

async function uploadFile(
  file: File, orgId: string, entityId: string, documentId: string,
): Promise<{ path?: string; error?: string }> {
  const supabase = createClient();
  const key = storageKey(orgId, entityId, documentId, file.name);
  const { error } = await supabase.storage
    .from('documents')
    .upload(key, file, { contentType: file.type, upsert: false });

  if (error) return { error: error.message };
  return { path: key };
}

// ---------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------

export async function createDocument(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();
    const supabase = createClient();

    const entityId = requiredString(formData.get('entity_id'), 'Entity');
    const documentTypeId = requiredString(formData.get('document_type_id'), 'Document type');
    const expiryDate = requiredString(formData.get('expiry_date'), 'Expiry date');
    const issueDate = nullifyEmpty(formData.get('issue_date'));

    if (!isValidIsoDate(expiryDate)) return fail('Enter the expiry date as YYYY-MM-DD.');
    if (issueDate && !isValidIsoDate(issueDate)) return fail('Enter the issue date as YYYY-MM-DD.');
    if (issueDate && issueDate > expiryDate) return fail('The issue date cannot be after the expiry date.');

    const { data, error } = await supabase
      .from('documents')
      .insert({
        entity_id: entityId,
        holder_id: nullifySelect(formData.get('holder_id')),
        document_type_id: documentTypeId,
        document_number: nullifyEmpty(formData.get('document_number')),
        issue_date: issueDate,
        expiry_date: expiryDate,
        responsible_user_id: nullifyEmpty(formData.get('responsible_user_id')) ?? session.userId,
        notes: nullifyEmpty(formData.get('notes')),
        needs_review: false,
      })
      .select('id')
      .single();

    if (error) return fail(error.message);

    const file = formData.get('file');
    if (file instanceof File && file.size > 0) {
      const upload = await uploadFile(file, session.organization.id, entityId, data.id);
      if (upload.error) {
        // The row is more valuable than the scan. Keep it, tell the truth.
        return { ok: true, documentId: data.id, error: `Saved, but the file did not upload: ${upload.error}` };
      }
      await supabase.from('documents').update({ file_path: upload.path }).eq('id', data.id);
    }

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'document.created',
      targetTable: 'documents',
      targetId: data.id,
      metadata: { expiry_date: expiryDate, document_type_id: documentTypeId },
    });

    revalidatePath('/', 'layout');
    return { ok: true, documentId: data.id };
  } catch (err) {
    return fail((err as Error).message);
  }
}

// ---------------------------------------------------------------------
// Renew - the action the whole dashboard is built around
// ---------------------------------------------------------------------

/**
 * A renewal never overwrites the expiring row.
 *
 * It inserts a new document carrying the same holder, type and owner, then
 * marks the old row `renewed` and points its superseded_by_id at the new
 * one. The chain is what lets someone answer "when did this last lapse?"
 * two years from now, and what an auditor will actually ask for.
 */
export async function renewDocument(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();
    const supabase = createClient();

    const documentId = requiredString(formData.get('document_id'), 'Document');
    const newExpiry = requiredString(formData.get('new_expiry_date'), 'New expiry date');
    const newIssue = nullifyEmpty(formData.get('new_issue_date'));

    if (!isValidIsoDate(newExpiry)) return fail('Enter the new expiry date as YYYY-MM-DD.');
    if (newIssue && !isValidIsoDate(newIssue)) return fail('Enter the new issue date as YYYY-MM-DD.');

    const { data: current, error: readError } = await supabase
      .from('documents').select('*').eq('id', documentId).maybeSingle();

    if (readError) return fail(readError.message);
    if (!current) return fail('That document no longer exists.');
    if (current.superseded_by_id) return fail('This document has already been renewed.');
    if (newExpiry <= current.expiry_date) {
      return fail('The new expiry date must be later than the current one.');
    }

    const { data: replacement, error: insertError } = await supabase
      .from('documents')
      .insert({
        entity_id: current.entity_id,
        holder_id: current.holder_id,
        document_type_id: current.document_type_id,
        document_number: nullifyEmpty(formData.get('new_document_number')) ?? current.document_number,
        issue_date: newIssue,
        expiry_date: newExpiry,
        responsible_user_id: current.responsible_user_id,
        notes: nullifyEmpty(formData.get('notes')),
        status: 'valid',
      })
      .select('id')
      .single();

    if (insertError) return fail(insertError.message);

    const file = formData.get('file');
    if (file instanceof File && file.size > 0) {
      const upload = await uploadFile(file, session.organization.id, current.entity_id, replacement.id);
      if (upload.path) {
        await supabase.from('documents').update({ file_path: upload.path }).eq('id', replacement.id);
      }
    }

    // Link the old row to the new one and retire it.
    const { error: linkError } = await supabase
      .from('documents')
      .update({ status: 'renewed', superseded_by_id: replacement.id })
      .eq('id', documentId);

    if (linkError) {
      // Roll the replacement back rather than leaving two live rows for the
      // same licence, which would double every future alert.
      await supabase.from('documents').delete().eq('id', replacement.id);
      return fail(`Could not complete the renewal: ${linkError.message}`);
    }

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'document.renewed',
      targetTable: 'documents',
      targetId: documentId,
      metadata: {
        replacement_id: replacement.id,
        previous_expiry: current.expiry_date,
        new_expiry: newExpiry,
      },
    });

    revalidatePath('/', 'layout');
    return { ok: true, documentId: replacement.id };
  } catch (err) {
    return fail((err as Error).message);
  }
}

// ---------------------------------------------------------------------
// Update / archive / bulk
// ---------------------------------------------------------------------

export async function updateDocument(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();
    const supabase = createClient();

    const documentId = requiredString(formData.get('document_id'), 'Document');
    const expiryDate = requiredString(formData.get('expiry_date'), 'Expiry date');
    const issueDate = nullifyEmpty(formData.get('issue_date'));

    if (!isValidIsoDate(expiryDate)) return fail('Enter the expiry date as YYYY-MM-DD.');
    if (issueDate && !isValidIsoDate(issueDate)) return fail('Enter the issue date as YYYY-MM-DD.');
    if (issueDate && issueDate > expiryDate) return fail('The issue date cannot be after the expiry date.');

    const { error } = await supabase
      .from('documents')
      .update({
        document_number: nullifyEmpty(formData.get('document_number')),
        issue_date: issueDate,
        expiry_date: expiryDate,
        holder_id: nullifySelect(formData.get('holder_id')),
        responsible_user_id: nullifyEmpty(formData.get('responsible_user_id')),
        notes: nullifyEmpty(formData.get('notes')),
        needs_review: false,
      })
      .eq('id', documentId);

    if (error) return fail(error.message);

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'document.updated',
      targetTable: 'documents',
      targetId: documentId,
      metadata: { expiry_date: expiryDate },
    });

    revalidatePath('/', 'layout');
    return { ok: true, documentId };
  } catch (err) {
    return fail((err as Error).message);
  }
}

export async function archiveDocuments(ids: string[]): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();
    if (!ids.length) return fail('Select at least one document.');
    const supabase = createClient();

    const { error } = await supabase
      .from('documents').update({ status: 'archived' }).in('id', ids);

    if (error) return fail(error.message);

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'document.archived',
      targetTable: 'documents',
      metadata: { ids, count: ids.length },
    });

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    return fail((err as Error).message);
  }
}

export async function reassignDocuments(ids: string[], userId: string): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();
    if (!ids.length) return fail('Select at least one document.');
    const supabase = createClient();

    const { error } = await supabase
      .from('documents').update({ responsible_user_id: userId }).in('id', ids);

    if (error) return fail(error.message);

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'document.bulk_reassigned',
      targetTable: 'documents',
      metadata: { ids, count: ids.length, responsible_user_id: userId },
    });

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    return fail((err as Error).message);
  }
}

export async function deleteDocument(documentId: string): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();
    const supabase = createClient();

    const { data: doc } = await supabase
      .from('documents').select('file_path').eq('id', documentId).maybeSingle();

    const { error } = await supabase.from('documents').delete().eq('id', documentId);
    if (error) return fail(error.message);

    if (doc?.file_path) {
      await supabase.storage.from('documents').remove([doc.file_path]);
    }

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'document.deleted',
      targetTable: 'documents',
      targetId: documentId,
    });

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    return fail((err as Error).message);
  }
}

// ---------------------------------------------------------------------
// File access
// ---------------------------------------------------------------------

/**
 * Mint a 60-second signed URL for a stored file.
 *
 * Viewers are refused here AND by the storage RLS policy. Two independent
 * checks, because a file leak is the failure this product can least afford.
 * Every successful download is written to the audit log.
 */
export async function getSignedFileUrl(documentId: string): Promise<ActionResult> {
  try {
    const session = await requireSession();

    if (!canDownloadFiles(session.profile.role)) {
      return fail('Your account is read-only and cannot open files.');
    }

    const supabase = createClient();
    const { data: doc, error } = await supabase
      .from('documents').select('id, file_path').eq('id', documentId).maybeSingle();

    if (error) return fail(error.message);
    if (!doc?.file_path) return fail('There is no file attached to this document.');

    const { data: signed, error: signError } = await supabase.storage
      .from('documents')
      .createSignedUrl(doc.file_path, 60);

    if (signError || !signed) return fail(signError?.message ?? 'Could not open that file.');

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'document.file_downloaded',
      targetTable: 'documents',
      targetId: documentId,
      metadata: { file_path: doc.file_path, expires_in_seconds: 60 },
    });

    return { ok: true, url: signed.signedUrl };
  } catch (err) {
    return fail((err as Error).message);
  }
}
