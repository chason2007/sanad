import type { OrgPlan } from '@/lib/types';

export interface PlanDefinition {
  id: OrgPlan;
  name: string;
  priceAed: number;
  documentLimit: number;
  entityLimit: number;
  blurb: string;
  features: string[];
  priceEnvVar: string;
}

/**
 * Limits live here AND on the organizations row. The row is what the app
 * enforces, because a webhook is the only thing allowed to change what a
 * customer has paid for; this table is what the pricing page renders and
 * what the webhook copies onto the row when a subscription changes.
 */
export const PLANS: PlanDefinition[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceAed: 199,
    documentLimit: 100,
    entityLimit: 1,
    blurb: 'One company, up to 100 documents.',
    features: [
      'Up to 100 documents',
      'One company',
      'Email reminders on your schedule',
      'Monthly compliance report',
      'Unlimited people and assets',
    ],
    priceEnvVar: 'STRIPE_PRICE_STARTER',
  },
  {
    id: 'growth',
    name: 'Growth',
    priceAed: 449,
    documentLimit: 500,
    entityLimit: 3,
    blurb: 'For a firm with a few licences to keep straight.',
    features: [
      'Up to 500 documents',
      'Up to 3 companies',
      'Email and WhatsApp reminders',
      'Escalation when a reminder is ignored',
      'Monthly compliance report',
    ],
    priceEnvVar: 'STRIPE_PRICE_GROWTH',
  },
  {
    id: 'multi_entity',
    name: 'Multi-entity',
    priceAed: 999,
    documentLimit: 5000,
    entityLimit: 25,
    blurb: 'Group structures and holding companies.',
    features: [
      'Up to 5,000 documents',
      'Up to 25 companies',
      'Email and WhatsApp reminders',
      'Per-entity escalation contacts',
      'Consolidated and per-entity reports',
      'Full audit log export',
    ],
    priceEnvVar: 'STRIPE_PRICE_MULTI_ENTITY',
  },
];

export const planById = (id: OrgPlan) => PLANS.find((p) => p.id === id) ?? PLANS[0];

/** Map a Stripe price id back to a plan, for the webhook. */
export function planForPriceId(priceId: string): PlanDefinition | null {
  for (const plan of PLANS) {
    if (process.env[plan.priceEnvVar] === priceId) return plan;
  }
  return null;
}
