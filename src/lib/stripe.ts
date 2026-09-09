import Stripe from 'stripe';

let cached: Stripe | null = null;

/**
 * Lazily constructed so the app boots (and the register works) without
 * Stripe configured. Billing is the only thing that should break when the
 * key is missing - not the dashboard someone opens to check a visa date.
 */
export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
  cached = new Stripe(key, { apiVersion: '2025-10-29.clover' });
  return cached;
}

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
