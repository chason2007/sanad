import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { dubaiToday } from '@/lib/dates';
import {
  planAlerts, planEscalations, alertKey, overrideKey,
  type EscalationCandidate, type PlannedAlert,
} from '@/lib/alerts/planner';
import { renderAlertEmail, renderEscalationEmail, sendEmail } from '@/lib/alerts/email';
import { alertActionUrl } from '@/lib/alerts/tokens';
import type {
  AlertRule, DocumentType, Entity, Profile, RegisterRow,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Stop sending before the platform kills the function mid-flight. */
const SOFT_DEADLINE_MS = 50_000;
/** A row claimed but never sent (crash between insert and send) is retried. */
const STUCK_QUEUE_MINUTES = 15;
/** Genuine delivery failures are retried, but only so many times. */
const MAX_DELIVERY_ATTEMPTS = 3;
/** After this long a missed reminder is stale; stop retrying it. */
const RETRY_WINDOW_HOURS = 24;

/**
 * POST /api/cron/alerts - the daily reminder run.
 *
 * Scheduled at 03:00 UTC, which is 07:00 Gulf Standard Time: the reminder
 * is in the inbox before the working day starts in the UAE. GST has no
 * daylight saving, so the mapping is stable year-round.
 *
 * ORDERING MATTERS. For each reminder the row is INSERTed first, with
 * delivery_status 'queued', and only then is the email sent. The unique
 * index on (document_id, lead_day, channel, recipient_user_id) is what
 * claims the send: if two runs overlap, the second insert fails and that
 * run skips. Sending first and recording afterwards would mean a crash in
 * between produces a duplicate on the next run - and this product's whole
 * promise is that it is trustworthy, so the same person must never be
 * chased twice for the same document on the same day.
 *
 * The cost of that ordering is a row that is claimed but never sent if the
 * process dies in between. The stuck-queue sweep at the top of each run
 * picks those up, so at-most-once does not quietly become never.
 *
 * ?dry_run=true returns the full plan and writes nothing.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  }

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const auth = request.headers.get('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (presented !== secret) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dry_run') === 'true';
  const now = new Date();
  const today = dubaiToday(now);

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  // ---- load the world (service role: this job has no user session) ----
  const [documentsRes, rulesRes, typesRes, profilesRes, entitiesRes] = await Promise.all([
    supabase.from('document_register').select('*').limit(10_000),
    supabase.from('alert_rules').select('*'),
    supabase.from('document_types').select('id, default_lead_days, renewal_checklist, typical_lead_time_days'),
    supabase.from('profiles').select('*'),
    supabase.from('entities').select('*'),
  ]);

  const firstError = [documentsRes, rulesRes, typesRes, profilesRes, entitiesRes]
    .find((r) => r.error)?.error;
  if (firstError) {
    return NextResponse.json({ error: `Could not load data: ${firstError.message}` }, { status: 500 });
  }

  const documents = (documentsRes.data ?? []) as RegisterRow[];
  const rules = (rulesRes.data ?? []) as AlertRule[];
  const types = (typesRes.data ?? []) as Array<Pick<DocumentType,
    'id' | 'default_lead_days' | 'renewal_checklist' | 'typical_lead_time_days'>>;
  const profiles = (profilesRes.data ?? []) as Profile[];
  const entities = (entitiesRes.data ?? []) as Entity[];

  const profilesById = new Map(profiles.map((p) => [p.id, p]));
  const entitiesById = new Map(entities.map((e) => [e.id, e]));
  const typesById = new Map(types.map((t) => [t.id, t]));

  const ownersByOrg = new Map<string, Profile>();
  for (const p of profiles) {
    if (p.role === 'owner' && !ownersByOrg.has(p.org_id)) ownersByOrg.set(p.org_id, p);
  }

  const overrides = new Map(rules.map((r) => [overrideKey(r.org_id, r.document_type_id), r.lead_days]));
  const defaults = new Map(types.map((t) => [t.id, t.default_lead_days]));

  // Existing keys: a cheap pre-filter. The unique index is the real guard.
  const { data: existing } = await supabase
    .from('alerts').select('document_id, lead_day, channel, recipient_user_id');
  const existingKeys = new Set(
    (existing ?? []).map((a: any) => alertKey(a.document_id, a.lead_day, a.channel, a.recipient_user_id)),
  );

  const plan = planAlerts({
    documents, overrides, defaults,
    profiles: profilesById, entities: entitiesById, ownersByOrg,
    existingKeys, now,
  });

  // ---- escalation candidates ----
  const cutoff = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const { data: unacked } = await supabase
    .from('alerts')
    .select('id, document_id, lead_day, sent_at, recipient_user_id')
    .is('acknowledged_at', null)
    .is('escalated_at', null)
    .not('sent_at', 'is', null)
    .lte('sent_at', cutoff)
    .lte('lead_day', 30);

  const documentsById = new Map(documents.map((d) => [d.id, d]));

  // PostgREST returns snake_case columns; the planner speaks camelCase.
  const candidates: EscalationCandidate[] = (unacked ?? []).map((a: any) => ({
    alertId: a.id,
    documentId: a.document_id,
    leadDay: a.lead_day,
    sentAt: a.sent_at,
    recipientUserId: a.recipient_user_id,
  }));

  const escalationPlan = planEscalations({
    candidates, documentsById, entities: entitiesById, profiles: profilesById, now,
  });

  const describe = (a: PlannedAlert) => ({
    document_id: a.documentId,
    lead_day: a.leadDay,
    to: a.context.recipientEmail,
    why_this_person: a.context.recipientReason,
    subject: renderAlertEmail(buildEmailInput(a, typesById)).subject,
  });

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      dubai_today: today,
      scanned: plan.scanned,
      would_send: plan.send.map(describe),
      would_escalate: escalationPlan.escalate.map((e) => ({
        document_id: e.documentId, lead_day: e.leadDay,
        to: e.escalateToEmail, hours_since_sent: e.hoursSinceSent,
      })),
      would_update_status: plan.statusUpdates,
      skipped: [...plan.skipped, ...escalationPlan.skipped],
      email_configured: Boolean(process.env.RESEND_API_KEY),
      took_ms: Date.now() - started,
    });
  }

  // ---- 0. retry undelivered reminders ----
  //
  // Two cases, both meaning "nothing reached the recipient":
  //   a) claimed but never sent - the process died between insert and send
  //   b) sent and failed - the provider rejected it or was down
  // Retrying these is not re-sending: no message was delivered. Bounded by
  // attempts and by age so a permanently bad address is not retried nightly
  // forever.
  const stuckCutoff = new Date(now.getTime() - STUCK_QUEUE_MINUTES * 60_000).toISOString();
  const retryFloor = new Date(now.getTime() - RETRY_WINDOW_HOURS * 3_600_000).toISOString();

  const { data: undelivered } = await supabase
    .from('alerts')
    .select('id, document_id, lead_day, recipient_user_id, delivery_status, attempts, created_at')
    .or(`delivery_status.eq.failed,and(delivery_status.eq.queued,sent_at.is.null)`)
    .lt('attempts', MAX_DELIVERY_ATTEMPTS)
    .gte('created_at', retryFloor)
    .limit(200);

  let retried = 0;
  const retryFailures: Array<Record<string, unknown>> = [];

  for (const row of (undelivered ?? []) as any[]) {
    // A freshly-claimed row is mid-flight in this same run; leave it alone.
    if (row.delivery_status === 'queued' && row.created_at > stuckCutoff) continue;
    if (Date.now() - started > SOFT_DEADLINE_MS) break;

    const doc = documentsById.get(row.document_id);
    const profile = profilesById.get(row.recipient_user_id);
    if (!doc || !profile) continue;

    const result = await deliver(row.id, doc, profile, row.lead_day, typesById);
    await recordDelivery(supabase, row.id, result, (row.attempts ?? 0) + 1);
    retried += 1;
    if (!result.ok) {
      retryFailures.push({ alert_id: row.id, attempt: (row.attempts ?? 0) + 1, error: result.error });
    }
  }

  // ---- 1. status reconciliation ----
  let statusUpdated = 0;
  for (const update of plan.statusUpdates) {
    const { error } = await supabase
      .from('documents').update({ status: update.to }).eq('id', update.documentId);
    if (!error) statusUpdated += 1;
  }

  // ---- 2. claim, then send ----
  const sent: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];
  let deferred = 0;

  for (const planned of plan.send) {
    if (Date.now() - started > SOFT_DEADLINE_MS) { deferred += 1; continue; }

    // The insert IS the lock. A conflict means another run got here first.
    const { data: claimed, error: claimError } = await supabase
      .from('alerts')
      .insert({
        document_id: planned.documentId,
        lead_day: planned.leadDay,
        channel: planned.channel,
        recipient_user_id: planned.recipientUserId,
        delivery_status: 'queued',
      })
      .select('id')
      .single();

    if (claimError) {
      // 23505 = unique violation = already claimed. Anything else is real.
      if ((claimError as any).code !== '23505') {
        failed.push({ document_id: planned.documentId, lead_day: planned.leadDay, error: claimError.message });
      }
      continue;
    }

    const doc = documentsById.get(planned.documentId)!;
    const profile = profilesById.get(planned.recipientUserId)!;
    const result = await deliver(claimed.id, doc, profile, planned.leadDay, typesById);
    await recordDelivery(supabase, claimed.id, result, 1);

    (result.ok ? sent : failed).push({
      document_id: planned.documentId, lead_day: planned.leadDay,
      to: planned.context.recipientEmail, ...(result.ok ? {} : { error: result.error }),
    });
  }

  // ---- 3. escalation ----
  const escalated: Array<Record<string, unknown>> = [];
  for (const esc of escalationPlan.escalate) {
    if (Date.now() - started > SOFT_DEADLINE_MS) { deferred += 1; continue; }

    const doc = documentsById.get(esc.documentId);
    if (!doc) continue;
    const original = profilesById.get(esc.recipientUserId);

    const email = renderEscalationEmail({
      recipientName: esc.escalateToName,
      originalRecipientName: original?.full_name || original?.email || 'The responsible person',
      documentTypeLabel: doc.document_type_label,
      holderName: doc.holder_name,
      entityName: doc.entity_name,
      expiryDate: doc.expiry_date,
      daysRemaining: doc.days_remaining,
      hoursSinceSent: esc.hoursSinceSent,
      acknowledgeUrl: alertActionUrl({ alertId: esc.alertId, documentId: esc.documentId, action: 'acknowledge' }, now),
      renewUrl: alertActionUrl({ alertId: esc.alertId, documentId: esc.documentId, action: 'renew' }, now),
    });

    const result = await sendEmail({ to: esc.escalateToEmail, ...email });

    // Stamp escalated_at even if the send failed, so a broken mailbox does
    // not re-escalate the same alert every night forever.
    await supabase.from('alerts').update({ escalated_at: now.toISOString() }).eq('id', esc.alertId);

    escalated.push({
      alert_id: esc.alertId, document_id: esc.documentId,
      to: esc.escalateToEmail, ok: result.ok, ...(result.ok ? {} : { error: result.error }),
    });
  }

  return NextResponse.json({
    dry_run: false,
    dubai_today: today,
    scanned: plan.scanned,
    sent: sent.length,
    failed: failed.length,
    escalated: escalated.length,
    retried_undelivered: retried,
    retry_failures: retryFailures,
    status_updated: statusUpdated,
    deferred_to_next_run: deferred,
    skipped: [...plan.skipped, ...escalationPlan.skipped],
    details: { sent, failed, escalated },
    took_ms: Date.now() - started,
  });
}

// ---------------------------------------------------------------------

type TypeMap = Map<string, Pick<DocumentType, 'id' | 'default_lead_days' | 'renewal_checklist' | 'typical_lead_time_days'>>;

function buildEmailInput(planned: PlannedAlert, types: TypeMap) {
  const type = types.get(planned.context.documentTypeId);
  return {
    recipientName: planned.context.recipientName,
    documentTypeLabel: planned.context.documentTypeLabel,
    holderName: planned.context.holderName,
    entityName: planned.context.entityName,
    documentNumber: planned.context.documentNumber,
    expiryDate: planned.context.expiryDate,
    daysRemaining: planned.context.daysRemaining,
    checklist: type?.renewal_checklist ?? null,
    typicalLeadTimeDays: type?.typical_lead_time_days ?? null,
    acknowledgeUrl: '',
    renewUrl: '',
  };
}

async function deliver(
  alertId: string, doc: RegisterRow, profile: Profile, leadDay: number, types: TypeMap,
) {
  const type = types.get(doc.document_type_id);
  const email = renderAlertEmail({
    recipientName: profile.full_name || profile.email,
    documentTypeLabel: doc.document_type_label,
    holderName: doc.holder_name,
    entityName: doc.entity_name,
    documentNumber: doc.document_number,
    expiryDate: doc.expiry_date,
    daysRemaining: leadDay,
    checklist: type?.renewal_checklist ?? null,
    typicalLeadTimeDays: type?.typical_lead_time_days ?? null,
    acknowledgeUrl: alertActionUrl({ alertId, documentId: doc.id, action: 'acknowledge' }),
    renewUrl: alertActionUrl({ alertId, documentId: doc.id, action: 'renew' }),
  });
  return sendEmail({ to: profile.email, ...email });
}

async function recordDelivery(
  supabase: ReturnType<typeof createAdminClient>,
  alertId: string,
  result: { ok: boolean; id?: string; error?: string },
  attempts: number,
) {
  const stamp = new Date().toISOString();
  await supabase
    .from('alerts')
    .update({
      // sent_at records when it actually left, so a failure leaves it null
      // and the row stays visibly undelivered.
      sent_at: result.ok ? stamp : null,
      last_attempt_at: stamp,
      attempts,
      delivery_status: result.ok ? 'sent' : 'failed',
      provider_message_id: result.id ?? null,
      error: result.error ?? null,
    })
    .eq('id', alertId);
}

/**
 * Vercel Cron invokes scheduled endpoints with GET, not POST, and sends the
 * project's CRON_SECRET as `Authorization: Bearer ...`. The spec asks for
 * POST, so both verbs run the same handler and both require the token.
 *
 * The method is not the safety mechanism here - the bearer token and the
 * ?dry_run flag are.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}
