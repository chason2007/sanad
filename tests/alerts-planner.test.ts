import { describe, it, expect } from 'vitest';
import {
  planAlerts, planEscalations, alertKey, leadDaysFor, statusFor, overrideKey,
  ESCALATION_AFTER_HOURS, type PlanInput,
} from '@/lib/alerts/planner';
import type { Entity, Profile, RegisterRow } from '@/lib/types';

const NOW = new Date('2026-09-10T06:00:00Z'); // 10:00 Dubai, 10 Sep 2026
const TYPE = 'dt-visa';
const ORG = 'org-1';
const ENTITY = 'ent-1';

let seq = 0;
function doc(over: Partial<RegisterRow> & { expiry_date: string }): RegisterRow {
  seq += 1;
  return {
    id: `doc-${seq}`, entity_id: ENTITY, holder_id: 'h-1', document_type_id: TYPE,
    document_number: 'X-1', issue_date: null, file_path: null,
    responsible_user_id: 'user-resp', status: 'valid', notes: null,
    superseded_by_id: null, superseded_at: null, needs_review: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    org_id: ORG, entity_name: 'Al Noor Contracting LLC',
    holder_name: 'Rajesh Kumar', holder_type: 'employee', holder_identifier: 'EMP-002',
    document_type_code: 'employee_visa', document_type_label: 'Employee Residence Visa',
    responsible_name: 'Fatima Al Marzooqi', responsible_email: 'fatima@example.ae',
    days_remaining: 0, computed_status: 'valid',
    ...over,
  };
}

function profile(over: Partial<Profile> & { id: string }): Profile {
  return {
    org_id: ORG, full_name: 'Fatima Al Marzooqi',
    email: `${over.id}@example.ae`, phone_e164: null, role: 'admin',
    notification_email: true, notification_whatsapp: false,
    created_at: '', updated_at: '', ...over,
  };
}

const entity = (over: Partial<Entity> = {}): Entity => ({
  id: ENTITY, org_id: ORG, name: 'Al Noor Contracting LLC',
  trade_licence_number: null, emirate: 'Dubai',
  escalation_user_id: 'user-boss', created_at: '', updated_at: '', ...over,
});

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    documents: [],
    overrides: new Map(),
    defaults: new Map([[TYPE, [90, 60, 30, 7, 0]]]),
    profiles: new Map([
      ['user-resp', profile({ id: 'user-resp' })],
      ['user-boss', profile({ id: 'user-boss', full_name: 'Owner Boss' })],
    ]),
    entities: new Map([[ENTITY, entity()]]),
    ownersByOrg: new Map([[ORG, profile({ id: 'user-boss', role: 'owner' })]]),
    existingKeys: new Set(),
    now: NOW,
    ...over,
  };
}

describe('lead day matching', () => {
  it('fires on an exact lead day and nothing else', () => {
    // 90/60/30/7/0 from 10 Sep 2026
    const cases: Array<[string, boolean]> = [
      ['2026-12-09', true],   // 90
      ['2026-11-09', true],   // 60
      ['2026-10-10', true],   // 30
      ['2026-09-17', true],   // 7
      ['2026-09-10', true],   // 0  - due today
      ['2026-09-18', false],  // 8  - not a lead day
      ['2026-09-11', false],  // 1
      ['2026-10-09', false],  // 29
      ['2026-09-09', false],  // -1 already expired, no lead day matches
    ];

    for (const [expiry, shouldFire] of cases) {
      const result = planAlerts(input({ documents: [doc({ expiry_date: expiry })] }));
      expect(result.send.length, `${expiry} should ${shouldFire ? '' : 'not '}fire`)
        .toBe(shouldFire ? 1 : 0);
    }
  });

  it('never alerts on an already-expired document', () => {
    // Past the last lead day there is nothing left to warn about; the
    // dashboard carries it as expired instead of mailing daily forever.
    for (const expiry of ['2026-09-09', '2026-09-01', '2025-01-01']) {
      expect(planAlerts(input({ documents: [doc({ expiry_date: expiry })] })).send).toHaveLength(0);
    }
  });

  it('computes the lead day in Dubai, not UTC', () => {
    // 20:30 UTC is already 00:30 the next day in Dubai. A document expiring
    // on 17 Sep is 7 days out on 10 Sep, but only 6 once Dubai rolls over.
    const docs = [doc({ expiry_date: '2026-09-17' })];
    expect(planAlerts(input({ documents: docs, now: new Date('2026-09-10T19:59:00Z') })).send).toHaveLength(1);
    expect(planAlerts(input({ documents: docs, now: new Date('2026-09-10T20:01:00Z') })).send).toHaveLength(0);
  });
});

describe('lead day source', () => {
  it('prefers the org override over the document type default', () => {
    expect(leadDaysFor(ORG, TYPE, new Map([[overrideKey(ORG, TYPE), [45, 10]]]), new Map([[TYPE, [90, 7]]])))
      .toEqual([45, 10]);
  });

  it('falls back to the type default when there is no override', () => {
    expect(leadDaysFor(ORG, TYPE, new Map(), new Map([[TYPE, [90, 7]]]))).toEqual([90, 7]);
  });

  it('de-duplicates a malformed rule so it cannot double-send', () => {
    expect(leadDaysFor(ORG, TYPE, new Map([[overrideKey(ORG, TYPE), [30, 30, 7]]]), new Map()))
      .toEqual([30, 7]);
  });

  it('an override actually changes which day fires', () => {
    const docs = [doc({ expiry_date: '2026-09-25' })]; // 15 days out
    expect(planAlerts(input({ documents: docs })).send).toHaveLength(0);
    expect(planAlerts(input({
      documents: docs, overrides: new Map([[overrideKey(ORG, TYPE), [15]]]),
    })).send).toHaveLength(1);
  });

  it("one org override does NOT leak onto another org documents", () => {
    // alert_rules is unique on (org_id, document_type_id). Keying the
    // override map on the type alone would make org A's schedule govern
    // org B - a cross-tenant bug that sends the wrong reminders silently.
    const mine = doc({ expiry_date: '2026-09-25' });                       // org-1, 15 days
    const theirs = doc({ expiry_date: '2026-09-25', org_id: 'org-2' });    // org-2, 15 days

    const result = planAlerts(input({
      documents: [mine, theirs],
      overrides: new Map([[overrideKey(ORG, TYPE), [15]]]),
      ownersByOrg: new Map([
        [ORG, profile({ id: 'user-boss', role: 'owner' })],
        ['org-2', profile({ id: 'user-boss', role: 'owner' })],
      ]),
    }));

    expect(result.send).toHaveLength(1);
    expect(result.send[0].documentId).toBe(mine.id);
    expect(result.send[0].context.orgId).toBe(ORG);
  });

  it('sends nothing when a type has no lead days at all', () => {
    expect(planAlerts(input({
      documents: [doc({ expiry_date: '2026-09-17' })], defaults: new Map(),
    })).send).toHaveLength(0);
  });
});

describe('idempotency - the constraint that makes this trustworthy', () => {
  it('skips an alert that has already been sent', () => {
    const d = doc({ expiry_date: '2026-09-17' });
    const key = alertKey(d.id, 7, 'email', 'user-resp');
    const result = planAlerts(input({ documents: [d], existingKeys: new Set([key]) }));
    expect(result.send).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('already_sent');
  });

  it('running twice in a row sends nothing the second time', () => {
    const docs = [doc({ expiry_date: '2026-09-17' }), doc({ expiry_date: '2026-10-10' })];
    const first = planAlerts(input({ documents: docs }));
    expect(first.send).toHaveLength(2);

    const keys = new Set(first.send.map((a) => alertKey(a.documentId, a.leadDay, a.channel, a.recipientUserId)));
    expect(planAlerts(input({ documents: docs, existingKeys: keys })).send).toHaveLength(0);
  });

  it('never plans the same key twice within one run', () => {
    const d = doc({ expiry_date: '2026-09-17' });
    // Same document appearing twice in the snapshot must not double-send.
    const result = planAlerts(input({ documents: [d, { ...d }] }));
    expect(result.send).toHaveLength(1);
    expect(result.skipped.some((s) => s.reason === 'already_sent')).toBe(true);
  });

  it('the planned key matches the shape of the database unique index', () => {
    const result = planAlerts(input({ documents: [doc({ expiry_date: '2026-09-17' })] }));
    const a = result.send[0];
    expect(alertKey(a.documentId, a.leadDay, a.channel, a.recipientUserId))
      .toBe(`${a.documentId}|7|email|user-resp`);
  });
});

describe('who gets the email', () => {
  it('goes to the responsible user', () => {
    const result = planAlerts(input({ documents: [doc({ expiry_date: '2026-09-17' })] }));
    expect(result.send[0].recipientUserId).toBe('user-resp');
    expect(result.send[0].context.recipientReason).toBe('responsible');
  });

  it('falls back to the entity escalation contact when nobody is responsible', () => {
    const result = planAlerts(input({
      documents: [doc({ expiry_date: '2026-09-17', responsible_user_id: null })],
    }));
    expect(result.send[0].recipientUserId).toBe('user-boss');
    expect(result.send[0].context.recipientReason).toBe('escalation_fallback');
  });

  it('falls back to the org owner when there is no escalation contact either', () => {
    const result = planAlerts(input({
      documents: [doc({ expiry_date: '2026-09-17', responsible_user_id: null })],
      entities: new Map([[ENTITY, entity({ escalation_user_id: null })]]),
    }));
    expect(result.send[0].context.recipientReason).toBe('owner_fallback');
  });

  it('reports a document that would alert nobody rather than dropping it', () => {
    // Silence here would be the worst outcome: the customer believes a
    // reminder is armed and it is not.
    const result = planAlerts(input({
      documents: [doc({ expiry_date: '2026-09-17', responsible_user_id: null })],
      entities: new Map([[ENTITY, entity({ escalation_user_id: null })]]),
      ownersByOrg: new Map(),
    }));
    expect(result.send).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('no_recipient');
  });

  it('respects a recipient who turned email off', () => {
    const result = planAlerts(input({
      documents: [doc({ expiry_date: '2026-09-17' })],
      profiles: new Map([['user-resp', profile({ id: 'user-resp', notification_email: false })]]),
    }));
    expect(result.send).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('email_disabled');
  });
});

describe('excluded documents', () => {
  it.each(['archived', 'renewed'] as const)('never alerts on a %s document', (status) => {
    expect(planAlerts(input({
      documents: [doc({ expiry_date: '2026-09-17', status })],
    })).send).toHaveLength(0);
  });

  it('never alerts on a document that has been superseded', () => {
    expect(planAlerts(input({
      documents: [doc({ expiry_date: '2026-09-17', superseded_by_id: 'doc-999' })],
    })).send).toHaveLength(0);
  });
});

describe('status reconciliation', () => {
  it('moves a stale status to match the calendar', () => {
    const result = planAlerts(input({
      documents: [
        doc({ expiry_date: '2026-09-01', status: 'valid' }),        // expired
        doc({ expiry_date: '2026-09-20', status: 'valid' }),        // expiring_soon
        doc({ expiry_date: '2027-01-01', status: 'expiring_soon' }),// valid
      ],
    }));
    expect(result.statusUpdates.map((u) => u.to)).toEqual(['expired', 'expiring_soon', 'valid']);
  });

  it('leaves a correct status alone', () => {
    expect(planAlerts(input({
      documents: [doc({ expiry_date: '2027-01-01', status: 'valid' })],
    })).statusUpdates).toHaveLength(0);
  });

  it('never rewrites a renewed or archived document', () => {
    for (const status of ['renewed', 'archived'] as const) {
      expect(statusFor(doc({ expiry_date: '2020-01-01', status }), NOW)).toBe(status);
    }
  });

  it('a document expiring today is expiring_soon, not expired', () => {
    expect(statusFor(doc({ expiry_date: '2026-09-10' }), NOW)).toBe('expiring_soon');
    expect(statusFor(doc({ expiry_date: '2026-09-09' }), NOW)).toBe('expired');
  });
});

describe('escalation', () => {
  const base = {
    alertId: 'al-1', documentId: 'doc-1', leadDay: 7,
    sentAt: '2026-09-08T06:00:00Z', recipientUserId: 'user-resp',
  };
  const ctx = (over: Record<string, unknown> = {}) => ({
    candidates: [base],
    documentsById: new Map([['doc-1', doc({ id: 'doc-1', expiry_date: '2026-09-17' })]]),
    entities: new Map([[ENTITY, entity()]]),
    profiles: new Map([['user-boss', profile({ id: 'user-boss', full_name: 'Owner Boss' })]]),
    now: NOW,
    ...over,
  });

  it('escalates an unacknowledged alert after 48 hours', () => {
    const { escalate } = planEscalations(ctx());
    expect(escalate).toHaveLength(1);
    expect(escalate[0].escalateToUserId).toBe('user-boss');
    expect(escalate[0].hoursSinceSent).toBe(48);
  });

  it('does not escalate before 48 hours', () => {
    const justUnder = new Date(NOW.getTime() - (ESCALATION_AFTER_HOURS - 1) * 3_600_000);
    const { escalate } = planEscalations(ctx({
      candidates: [{ ...base, sentAt: justUnder.toISOString() }],
    }));
    expect(escalate).toHaveLength(0);
  });

  it('does not escalate long-horizon reminders', () => {
    // Escalating the 90-day nudge trains people to ignore escalations.
    for (const leadDay of [60, 90]) {
      expect(planEscalations(ctx({ candidates: [{ ...base, leadDay }] })).escalate).toHaveLength(0);
    }
    expect(planEscalations(ctx({ candidates: [{ ...base, leadDay: 30 }] })).escalate).toHaveLength(1);
  });

  it('does not escalate to the person who already ignored it', () => {
    const { escalate, skipped } = planEscalations(ctx({
      entities: new Map([[ENTITY, entity({ escalation_user_id: 'user-resp' })]]),
      profiles: new Map([['user-resp', profile({ id: 'user-resp' })]]),
    }));
    expect(escalate).toHaveLength(0);
    expect(skipped[0].detail).toMatch(/same person/i);
  });

  it('reports an entity with no escalation contact', () => {
    const { escalate, skipped } = planEscalations(ctx({
      entities: new Map([[ENTITY, entity({ escalation_user_id: null })]]),
    }));
    expect(escalate).toHaveLength(0);
    expect(skipped[0].detail).toMatch(/no escalation contact/i);
  });

  it('does not escalate once the document has been renewed', () => {
    const { escalate } = planEscalations(ctx({
      documentsById: new Map([['doc-1', doc({ id: 'doc-1', expiry_date: '2026-09-17', status: 'renewed' })]]),
    }));
    expect(escalate).toHaveLength(0);
  });
});
