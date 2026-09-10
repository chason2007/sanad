import { planById } from '@/lib/plans';
import type { Organization } from '@/lib/types';

/**
 * What an organisation is currently allowed to do.
 *
 * The degradation order here is a deliberate product decision, not an
 * accident of implementation: when a payment fails, the things that make
 * Sanad pleasant stop first and the thing that makes it *safe* stops last.
 *
 * A lapsed employee visa costs AED 100 a day and can cost someone their
 * right to work. Silencing that because a card expired would be indefensible
 * - the customer would find out from a fine, and we would deserve the
 * lawsuit. So alerts keep running for 30 days past delinquency, and even
 * after that the register stays readable rather than being locked away.
 */

export const GRACE_DAYS = 30;

export type BillingState = 'healthy' | 'grace' | 'lapsed';

export interface Entitlements {
  state: BillingState;
  /** Reminder emails still go out. */
  alertsEnabled: boolean;
  /** Adding documents, entities, uploads, invites. */
  canCreate: boolean;
  /**
   * Marking renewed, acknowledging, correcting a date. Always true:
   * blocking someone from recording that they FIXED a compliance problem
   * would be perverse, and it would keep the alert firing besides.
   */
  canMaintain: boolean;
  documentLimit: number;
  entityLimit: number;
  /** Days of alerting left, once delinquent. */
  graceDaysRemaining: number | null;
  reason: string | null;
}

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

export function entitlementsFor(
  org: Pick<Organization, 'status' | 'plan'> & {
    document_limit?: number;
    entity_limit?: number;
    delinquent_since?: string | null;
  },
  now: Date = new Date(),
): Entitlements {
  const base = {
    documentLimit: org.document_limit ?? 0,
    entityLimit: org.entity_limit ?? 0,
    canMaintain: true,
  };

  if (org.status === 'active' || org.status === 'trialing') {
    return {
      ...base, state: 'healthy', alertsEnabled: true, canCreate: true,
      graceDaysRemaining: null, reason: null,
    };
  }

  const elapsed = daysSince(org.delinquent_since ?? null, now);

  // No timestamp yet (webhook raced the trigger): treat as day zero rather
  // than as expired. Failing open on alerts is the safe direction.
  const used = elapsed ?? 0;
  const remaining = Math.max(GRACE_DAYS - used, 0);

  if (remaining > 0) {
    return {
      ...base,
      state: 'grace',
      alertsEnabled: true,
      canCreate: false,
      graceDaysRemaining: remaining,
      reason:
        org.status === 'past_due'
          ? `Your last payment failed. Reminders keep sending for ${remaining} more ${remaining === 1 ? 'day' : 'days'}.`
          : `Your subscription is cancelled. Reminders keep sending for ${remaining} more ${remaining === 1 ? 'day' : 'days'}.`,
    };
  }

  return {
    ...base,
    state: 'lapsed',
    alertsEnabled: false,
    canCreate: false,
    graceDaysRemaining: 0,
    reason:
      'Reminders are paused because the subscription has been unpaid for over 30 days. Your register is still here and still readable.',
  };
}

// ---------------------------------------------------------------------
// Limit checks
// ---------------------------------------------------------------------

export interface LimitCheck {
  allowed: boolean;
  /** Message shown to the user. Always names the way forward. */
  message?: string;
  atLimit: boolean;
  used: number;
  limit: number;
}

function suggestUpgrade(current: string, need: 'documents' | 'entities'): string {
  const order = ['starter', 'growth', 'multi_entity'];
  const next = order[order.indexOf(current) + 1];
  if (!next) {
    return `You are on the largest plan. Contact us and we will raise your ${need} limit.`;
  }
  const plan = planById(next as never);
  const size = need === 'documents' ? plan.documentLimit : plan.entityLimit;
  return `Upgrade to ${plan.name} (AED ${plan.priceAed}/month) for ${size.toLocaleString('en-AE')} ${need}.`;
}

export function checkDocumentLimit(
  org: Pick<Organization, 'plan' | 'document_limit' | 'status'> & { delinquent_since?: string | null },
  currentCount: number,
  now: Date = new Date(),
): LimitCheck {
  const ent = entitlementsFor(org, now);
  const limit = org.document_limit;
  const atLimit = currentCount >= limit;

  if (!ent.canCreate) {
    return {
      allowed: false, atLimit, used: currentCount, limit,
      message: `${ent.reason} You can still renew and update what is already here.`,
    };
  }
  if (atLimit) {
    return {
      allowed: false, atLimit: true, used: currentCount, limit,
      message: `You have used all ${limit.toLocaleString('en-AE')} documents on your plan. ${suggestUpgrade(org.plan, 'documents')}`,
    };
  }
  return { allowed: true, atLimit: false, used: currentCount, limit };
}

export function checkEntityLimit(
  org: Pick<Organization, 'plan' | 'entity_limit' | 'status'> & { delinquent_since?: string | null },
  currentCount: number,
  now: Date = new Date(),
): LimitCheck {
  const ent = entitlementsFor(org, now);
  const limit = org.entity_limit;
  const atLimit = currentCount >= limit;

  if (!ent.canCreate) {
    return {
      allowed: false, atLimit, used: currentCount, limit,
      message: `${ent.reason} You can still renew and update what is already here.`,
    };
  }
  if (atLimit) {
    return {
      allowed: false, atLimit: true, used: currentCount, limit,
      message: `Your plan covers ${limit} ${limit === 1 ? 'company' : 'companies'}. ${suggestUpgrade(org.plan, 'entities')}`,
    };
  }
  return { allowed: true, atLimit: false, used: currentCount, limit };
}

/** Warn before the wall, so hitting it is never a surprise. */
export const isNearLimit = (used: number, limit: number) =>
  limit > 0 && used >= Math.floor(limit * 0.8) && used < limit;
