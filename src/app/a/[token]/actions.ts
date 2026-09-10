'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyAlertToken } from '@/lib/alerts/tokens';
import { isValidIsoDate } from '@/lib/dates';
import { recordAudit } from '@/lib/audit';
import { nullifyEmpty } from '@/lib/utils';

/**
 * Actions reachable from an alert email, authorised by a signed token
 * rather than a session.
 *
 * These are Server Actions, which are POST-only. That is deliberate and
 * load-bearing: corporate mail gateways and Gmail's image proxy routinely
 * fetch every URL in an email to scan it. If acknowledging were a GET, a
 * spam filter would silently acknowledge alerts nobody had read, and
 * escalation - the feature that catches the reminder being ignored - would
 * quietly stop working. So the link opens a page; the page posts.
 *
 * The service-role client is used because there is no user session. Every
 * function below therefore re-derives its scope from the token and touches
 * only the one alert and one document the token names.
 */

export interface TokenActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function resolve(token: string, expected: 'acknowledge' | 'renew') {
  const verified = verifyAlertToken(token);
  if (!verified.ok) {
    const message =
      verified.reason === 'expired'
        ? 'This link has expired. Please sign in to Sanad instead.'
        : 'This link is not valid.';
    return { error: message } as const;
  }
  if (verified.payload.t !== expected) {
    return { error: 'This link is not valid for that action.' } as const;
  }

  const supabase = createAdminClient();
  const { data: alert } = await supabase
    .from('alerts')
    .select('id, document_id, recipient_user_id, acknowledged_at')
    .eq('id', verified.payload.a)
    .maybeSingle();

  if (!alert) return { error: 'This reminder no longer exists.' } as const;

  // The token names both; if they disagree, something is wrong.
  if (alert.document_id !== verified.payload.d) {
    return { error: 'This link is not valid.' } as const;
  }

  const { data: document } = await supabase
    .from('document_register').select('*').eq('id', alert.document_id).maybeSingle();

  if (!document) return { error: 'That document no longer exists.' } as const;

  return { supabase, alert, document } as const;
}

export async function acknowledgeViaToken(token: string): Promise<TokenActionResult> {
  const resolved = await resolve(token, 'acknowledge');
  if ('error' in resolved) return { ok: false, error: resolved.error };

  const { supabase, alert, document } = resolved;

  if (alert.acknowledged_at) {
    return { ok: true, message: 'This reminder was already acknowledged.' };
  }

  const { error } = await supabase
    .from('alerts')
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: alert.recipient_user_id,
    })
    .eq('id', alert.id);

  if (error) return { ok: false, error: error.message };

  await recordAudit(supabase, {
    orgId: document.org_id,
    actorUserId: alert.recipient_user_id,
    action: 'alert.acknowledged',
    targetTable: 'alerts',
    targetId: alert.id,
    metadata: { via: 'email_link', document_id: document.id },
  });

  revalidatePath('/', 'layout');
  return { ok: true, message: 'Acknowledged. You will not be chased about this one again.' };
}

export async function renewViaToken(
  token: string, formData: FormData,
): Promise<TokenActionResult> {
  const resolved = await resolve(token, 'renew');
  if ('error' in resolved) return { ok: false, error: resolved.error };

  const { supabase, alert, document } = resolved;

  const newExpiry = nullifyEmpty(formData.get('new_expiry_date'));
  if (!newExpiry || !isValidIsoDate(newExpiry)) {
    return { ok: false, error: 'Enter the new expiry date.' };
  }
  if (newExpiry <= document.expiry_date) {
    return { ok: false, error: 'The new expiry date must be later than the current one.' };
  }
  if (document.superseded_by_id) {
    return { ok: true, message: 'This document has already been renewed. Nothing to do.' };
  }

  // Same shape as the in-app renewal: insert the replacement, then retire
  // the old row and point it at the new one, so the history chain holds.
  const { data: replacement, error: insertError } = await supabase
    .from('documents')
    .insert({
      entity_id: document.entity_id,
      holder_id: document.holder_id,
      document_type_id: document.document_type_id,
      document_number: document.document_number,
      issue_date: null,
      expiry_date: newExpiry,
      responsible_user_id: document.responsible_user_id,
      notes: 'Renewed from an alert email.',
      status: 'valid',
    })
    .select('id')
    .single();

  if (insertError) return { ok: false, error: insertError.message };

  const { error: linkError } = await supabase
    .from('documents')
    .update({ status: 'renewed', superseded_by_id: replacement.id })
    .eq('id', document.id);

  if (linkError) {
    await supabase.from('documents').delete().eq('id', replacement.id);
    return { ok: false, error: `Could not complete the renewal: ${linkError.message}` };
  }

  await supabase
    .from('alerts')
    .update({
      acknowledged_at: alert.acknowledged_at ?? new Date().toISOString(),
      acknowledged_by: alert.recipient_user_id,
    })
    .eq('id', alert.id);

  await recordAudit(supabase, {
    orgId: document.org_id,
    actorUserId: alert.recipient_user_id,
    action: 'document.renewed',
    targetTable: 'documents',
    targetId: document.id,
    metadata: {
      via: 'email_link',
      replacement_id: replacement.id,
      previous_expiry: document.expiry_date,
      new_expiry: newExpiry,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true, message: `Recorded. This document now expires ${newExpiry}.` };
}
