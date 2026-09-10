import { describe, it, expect } from 'vitest';
import {
  entitlementsFor, checkDocumentLimit, checkEntityLimit, isNearLimit, GRACE_DAYS,
} from '@/lib/billing';
import { PLANS, planById } from '@/lib/plans';
import type { Organization } from '@/lib/types';

const NOW = new Date('2026-09-10T06:00:00Z');

const org = (over: Partial<Organization> & { delinquent_since?: string | null } = {}) => ({
  status: 'active' as const,
  plan: 'starter' as const,
  document_limit: 50,
  entity_limit: 1,
  delinquent_since: null,
  ...over,
});

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('plan tiers match the price list', () => {
  it.each([
    ['starter', 149, 1, 50],
    ['growth', 399, 1, 250],
    ['multi_entity', 999, 10, 2000],
  ])('%s is AED %i, %i entities, %i documents', (id, price, entities, documents) => {
    const plan = planById(id as never);
    expect(plan.priceAed).toBe(price);
    expect(plan.entityLimit).toBe(entities);
    expect(plan.documentLimit).toBe(documents);
  });

  it('has exactly three tiers', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['starter', 'growth', 'multi_entity']);
  });
});

describe('degradation order - alerts are the last thing to go', () => {
  it('a healthy org can do everything', () => {
    const e = entitlementsFor(org(), NOW);
    expect(e).toMatchObject({ state: 'healthy', alertsEnabled: true, canCreate: true, canMaintain: true });
  });

  it('a trialing org can do everything', () => {
    const e = entitlementsFor(org({ status: 'trialing' }), NOW);
    expect(e.canCreate).toBe(true);
    expect(e.alertsEnabled).toBe(true);
  });

  it.each(['past_due', 'cancelled'] as const)(
    'on %s: creating stops immediately but alerts keep going', (status) => {
      const e = entitlementsFor(org({ status, delinquent_since: daysAgo(0) }), NOW);
      expect(e.state).toBe('grace');
      expect(e.canCreate).toBe(false);
      expect(e.alertsEnabled).toBe(true);
      expect(e.canMaintain).toBe(true);
    },
  );

  it('keeps alerting for the full 30 days', () => {
    for (const d of [0, 1, 15, 29]) {
      const e = entitlementsFor(org({ status: 'past_due', delinquent_since: daysAgo(d) }), NOW);
      expect(e.alertsEnabled, `day ${d}`).toBe(true);
      expect(e.graceDaysRemaining).toBe(GRACE_DAYS - d);
    }
  });

  it('stops alerting only after 30 days', () => {
    const at30 = entitlementsFor(org({ status: 'past_due', delinquent_since: daysAgo(30) }), NOW);
    expect(at30.alertsEnabled).toBe(false);
    expect(at30.state).toBe('lapsed');

    const at31 = entitlementsFor(org({ status: 'cancelled', delinquent_since: daysAgo(31) }), NOW);
    expect(at31.alertsEnabled).toBe(false);
  });

  it('never blocks maintenance, even fully lapsed', () => {
    // Blocking someone from recording that they renewed a licence would
    // keep the alert firing and help nobody.
    const e = entitlementsFor(org({ status: 'cancelled', delinquent_since: daysAgo(400) }), NOW);
    expect(e.canMaintain).toBe(true);
  });

  it('fails open on alerts when the timestamp is missing', () => {
    // A webhook racing the trigger must not silence compliance alerts.
    const e = entitlementsFor(org({ status: 'past_due', delinquent_since: null }), NOW);
    expect(e.alertsEnabled).toBe(true);
    expect(e.graceDaysRemaining).toBe(GRACE_DAYS);
  });

  it('explains itself in words a non-technical owner can act on', () => {
    const grace = entitlementsFor(org({ status: 'past_due', delinquent_since: daysAgo(5) }), NOW);
    expect(grace.reason).toMatch(/payment failed/i);
    expect(grace.reason).toMatch(/25 more days/);

    const lapsed = entitlementsFor(org({ status: 'cancelled', delinquent_since: daysAgo(60) }), NOW);
    expect(lapsed.reason).toMatch(/still here and still readable/i);
  });
});

describe('document limits', () => {
  it('allows creation below the limit', () => {
    expect(checkDocumentLimit(org(), 49, NOW).allowed).toBe(true);
  });

  it('blocks at the limit with a clear upgrade path, not a silent failure', () => {
    const check = checkDocumentLimit(org(), 50, NOW);
    expect(check.allowed).toBe(false);
    expect(check.atLimit).toBe(true);
    expect(check.message).toContain('all 50 documents');
    expect(check.message).toContain('Growth');
    expect(check.message).toContain('250');
    expect(check.message).toContain('AED 399');
  });

  it('points Growth customers at Multi-entity', () => {
    const check = checkDocumentLimit(org({ plan: 'growth', document_limit: 250 }), 250, NOW);
    expect(check.message).toContain('Multi-entity');
    expect(check.message).toContain('2,000');
  });

  it('does not dead-end the largest plan', () => {
    const check = checkDocumentLimit(org({ plan: 'multi_entity', document_limit: 2000 }), 2000, NOW);
    expect(check.message).toMatch(/contact us/i);
  });

  it('blocks creation during grace, and says maintenance still works', () => {
    const check = checkDocumentLimit(
      org({ status: 'past_due', delinquent_since: daysAgo(2) }), 1, NOW,
    );
    expect(check.allowed).toBe(false);
    expect(check.atLimit).toBe(false); // blocked by billing, not by size
    expect(check.message).toMatch(/renew and update/i);
  });
});

describe('entity limits', () => {
  it('blocks a second company on Starter and Growth', () => {
    for (const plan of ['starter', 'growth'] as const) {
      const check = checkEntityLimit(org({ plan, entity_limit: 1 }), 1, NOW);
      expect(check.allowed).toBe(false);
      expect(check.message).toContain('1 company');
    }
  });

  it('allows up to ten on Multi-entity', () => {
    expect(checkEntityLimit(org({ plan: 'multi_entity', entity_limit: 10 }), 9, NOW).allowed).toBe(true);
    expect(checkEntityLimit(org({ plan: 'multi_entity', entity_limit: 10 }), 10, NOW).allowed).toBe(false);
  });

  it('sends a Starter customer straight to Multi-entity for more companies', () => {
    // Growth has the same single-entity limit, so suggesting it would be
    // useless advice - but it is the honest next tier by price.
    const check = checkEntityLimit(org(), 1, NOW);
    expect(check.message).toMatch(/Growth|Multi-entity/);
  });
});

describe('near-limit warning', () => {
  it('warns from 80% so the wall is never a surprise', () => {
    expect(isNearLimit(39, 50)).toBe(false);
    expect(isNearLimit(40, 50)).toBe(true);
    expect(isNearLimit(49, 50)).toBe(true);
    expect(isNearLimit(50, 50)).toBe(false); // at the limit, not near it
  });
});
