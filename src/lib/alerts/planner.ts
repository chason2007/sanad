import { daysUntil, type IsoDate } from '@/lib/dates';
import type {
  AlertChannel, DocumentStatus, Entity, Profile, RegisterRow,
} from '@/lib/types';

/**
 * The alert engine's decision layer.
 *
 * Deliberately pure: it takes a snapshot of the register and returns what
 * *should* happen. No database, no email, no clock of its own. Everything
 * that decides whether a reminder fires on the right day is therefore
 * testable without any I/O, which is the only way to have real confidence
 * in a job that runs once a day and is invisible when it is wrong.
 */

export interface PlannedAlert {
  documentId: string;
  leadDay: number;
  channel: AlertChannel;
  recipientUserId: string;
  /** Everything the email template needs, resolved up front. */
  context: {
    orgId: string;
    entityId: string;
    entityName: string;
    documentTypeId: string;
    documentTypeCode: string;
    documentTypeLabel: string;
    documentNumber: string | null;
    holderName: string | null;
    expiryDate: IsoDate;
    daysRemaining: number;
    recipientName: string;
    recipientEmail: string;
    /** Why this person: they own it, or they are the fallback. */
    recipientReason: 'responsible' | 'escalation_fallback' | 'owner_fallback';
  };
}

export interface SkippedAlert {
  documentId: string;
  leadDay: number;
  reason:
    | 'already_sent'
    | 'no_recipient'
    | 'email_disabled';
  detail?: string;
}

export interface PlanInput {
  /** Rows from document_register. */
  documents: RegisterRow[];
  /** org alert_rules override, keyed by overrideKey(orgId, documentTypeId) */
  overrides: Map<string, number[]>;
  /** document_types default: document_type_id -> default_lead_days */
  defaults: Map<string, number[]>;
  /** All profiles in scope, by id. */
  profiles: Map<string, Profile>;
  /** Entities by id, for the escalation fallback. */
  entities: Map<string, Entity>;
  /** Org owner by org_id, for the last-resort fallback. */
  ownersByOrg: Map<string, Profile>;
  /** Existing alert keys, so a re-run is a no-op. */
  existingKeys: Set<string>;
  now?: Date;
}

export interface PlanResult {
  send: PlannedAlert[];
  skipped: SkippedAlert[];
  /** documents whose stored status no longer matches the calendar */
  statusUpdates: Array<{ documentId: string; from: DocumentStatus; to: DocumentStatus }>;
  scanned: number;
}

/** The shape of the unique index on alerts. */
export function alertKey(
  documentId: string, leadDay: number, channel: AlertChannel, recipientUserId: string,
): string {
  return `${documentId}|${leadDay}|${channel}|${recipientUserId}`;
}

/**
 * Renewed documents are excluded as well as archived ones.
 *
 * The spec says "every non-archived document", but a renewed row has been
 * superseded - its replacement carries the live expiry date and will raise
 * its own reminders. Alerting on it would chase someone about a licence
 * they already renewed, which is precisely the noise that makes people stop
 * reading these emails.
 */
const isAlertable = (row: RegisterRow) =>
  row.status !== 'archived' && row.status !== 'renewed' && !row.superseded_by_id;

/**
 * alert_rules is unique on (org_id, document_type_id), so the override map
 * MUST be keyed by both. Keying it on document_type_id alone would let one
 * tenant's custom schedule silently govern every other tenant's documents
 * of that type.
 */
export const overrideKey = (orgId: string, documentTypeId: string) =>
  `${orgId}|${documentTypeId}`;

/** Effective lead days: org override wins, else the document type default. */
export function leadDaysFor(
  orgId: string,
  documentTypeId: string,
  overrides: Map<string, number[]>,
  defaults: Map<string, number[]>,
): number[] {
  const chosen =
    overrides.get(overrideKey(orgId, documentTypeId)) ??
    defaults.get(documentTypeId) ??
    [];
  // Defensive: de-duplicate so a malformed rule cannot double-send, and sort
  // descending so the plan reads in the order a human expects.
  return Array.from(new Set(chosen)).sort((a, b) => b - a);
}

/** Date-derived status. Lifecycle states (renewed/archived) are preserved. */
export function statusFor(row: RegisterRow, now: Date): DocumentStatus {
  if (row.status === 'renewed' || row.status === 'archived') return row.status;
  const days = daysUntil(row.expiry_date, now);
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring_soon';
  return 'valid';
}

/**
 * Pick who hears about this document.
 *
 * A document with no responsible user must not silently alert nobody -
 * that is a reminder the customer believes is armed and is not. So it falls
 * back to the entity's escalation contact, then to the org owner.
 */
function resolveRecipient(
  row: RegisterRow,
  input: PlanInput,
): { profile: Profile; reason: PlannedAlert['context']['recipientReason'] } | null {
  const direct = row.responsible_user_id ? input.profiles.get(row.responsible_user_id) : undefined;
  if (direct) return { profile: direct, reason: 'responsible' };

  const entity = input.entities.get(row.entity_id);
  const escalation = entity?.escalation_user_id
    ? input.profiles.get(entity.escalation_user_id)
    : undefined;
  if (escalation) return { profile: escalation, reason: 'escalation_fallback' };

  const owner = input.ownersByOrg.get(row.org_id);
  if (owner) return { profile: owner, reason: 'owner_fallback' };

  return null;
}

export function planAlerts(input: PlanInput): PlanResult {
  const now = input.now ?? new Date();
  const send: PlannedAlert[] = [];
  const skipped: SkippedAlert[] = [];
  const statusUpdates: PlanResult['statusUpdates'] = [];
  // Guards against the same key being planned twice inside one run, which
  // would otherwise hit the unique index and abort a batch insert.
  const plannedThisRun = new Set<string>();

  let scanned = 0;

  for (const row of input.documents) {
    if (!isAlertable(row)) continue;
    scanned += 1;

    const nextStatus = statusFor(row, now);
    if (nextStatus !== row.status) {
      statusUpdates.push({ documentId: row.id, from: row.status, to: nextStatus });
    }

    const days = daysUntil(row.expiry_date, now);
    const leadDays = leadDaysFor(row.org_id, row.document_type_id, input.overrides, input.defaults);

    // Exact match only. A document 9 days out on a {30,7,0} schedule is not
    // due a reminder today - it will get one in two days.
    if (!leadDays.includes(days)) continue;

    const recipient = resolveRecipient(row, input);
    if (!recipient) {
      skipped.push({ documentId: row.id, leadDay: days, reason: 'no_recipient' });
      continue;
    }

    if (!recipient.profile.notification_email) {
      skipped.push({
        documentId: row.id, leadDay: days, reason: 'email_disabled',
        detail: recipient.profile.email,
      });
      continue;
    }

    const key = alertKey(row.id, days, 'email', recipient.profile.id);
    if (input.existingKeys.has(key) || plannedThisRun.has(key)) {
      skipped.push({ documentId: row.id, leadDay: days, reason: 'already_sent' });
      continue;
    }
    plannedThisRun.add(key);

    send.push({
      documentId: row.id,
      leadDay: days,
      channel: 'email',
      recipientUserId: recipient.profile.id,
      context: {
        orgId: row.org_id,
        entityId: row.entity_id,
        entityName: row.entity_name,
        documentTypeId: row.document_type_id,
        documentTypeCode: row.document_type_code,
        documentTypeLabel: row.document_type_label,
        documentNumber: row.document_number,
        holderName: row.holder_name,
        expiryDate: row.expiry_date,
        daysRemaining: days,
        recipientName: recipient.profile.full_name || recipient.profile.email,
        recipientEmail: recipient.profile.email,
        recipientReason: recipient.reason,
      },
    });
  }

  // Soonest first, so a long run sends the most urgent mail before anything
  // has a chance to time out.
  send.sort((a, b) => a.leadDay - b.leadDay);

  return { send, skipped, statusUpdates, scanned };
}

// ---------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------

export interface EscalationCandidate {
  alertId: string;
  documentId: string;
  leadDay: number;
  sentAt: string;
  recipientUserId: string;
}

export interface PlannedEscalation extends EscalationCandidate {
  escalateToUserId: string;
  escalateToEmail: string;
  escalateToName: string;
  hoursSinceSent: number;
}

export const ESCALATION_AFTER_HOURS = 48;
export const ESCALATION_MAX_LEAD_DAY = 30;

/**
 * An unacknowledged reminder inside the 30-day window is the case that
 * costs money, so after 48 hours it goes to the entity's escalation
 * contact.
 *
 * Escalating the 90- and 60-day reminders would train people to ignore the
 * escalation itself, which is why the lead day is capped.
 */
export function planEscalations(params: {
  candidates: EscalationCandidate[];
  documentsById: Map<string, RegisterRow>;
  entities: Map<string, Entity>;
  profiles: Map<string, Profile>;
  now?: Date;
}): { escalate: PlannedEscalation[]; skipped: SkippedAlert[] } {
  const now = params.now ?? new Date();
  const escalate: PlannedEscalation[] = [];
  const skipped: SkippedAlert[] = [];

  for (const candidate of params.candidates) {
    if (candidate.leadDay > ESCALATION_MAX_LEAD_DAY) continue;

    const hours = (now.getTime() - new Date(candidate.sentAt).getTime()) / 3_600_000;
    if (hours < ESCALATION_AFTER_HOURS) continue;

    const document = params.documentsById.get(candidate.documentId);
    if (!document || !isAlertable(document)) continue;

    const entity = params.entities.get(document.entity_id);
    const target = entity?.escalation_user_id
      ? params.profiles.get(entity.escalation_user_id)
      : undefined;

    if (!target) {
      skipped.push({
        documentId: candidate.documentId, leadDay: candidate.leadDay,
        reason: 'no_recipient', detail: 'no escalation contact set for this entity',
      });
      continue;
    }

    // Escalating to the person who already ignored it achieves nothing.
    if (target.id === candidate.recipientUserId) {
      skipped.push({
        documentId: candidate.documentId, leadDay: candidate.leadDay,
        reason: 'no_recipient',
        detail: 'escalation contact is the same person who was already alerted',
      });
      continue;
    }

    escalate.push({
      ...candidate,
      escalateToUserId: target.id,
      escalateToEmail: target.email,
      escalateToName: target.full_name || target.email,
      hoursSinceSent: Math.floor(hours),
    });
  }

  return { escalate, skipped };
}
