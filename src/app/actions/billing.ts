'use server';

import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';
import { planById } from '@/lib/plans';
import type { OrgPlan } from '@/lib/types';
import type { ActionResult } from '@/app/actions/documents';

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

/**
 * Start a Stripe Checkout session for a plan.
 *
 * Note what is NOT here: the plan limits. Checkout only records intent.
 * The organizations row is updated by the webhook, after Stripe confirms
 * money actually moved - so a user who bookmarks the success URL, or
 * abandons payment, never gets an upgraded limit.
 */
export async function startCheckout(plan: OrgPlan): Promise<ActionResult> {
  try {
    const session = await requireRole('owner');
    const definition = planById(plan);
    const priceId = process.env[definition.priceEnvVar];

    if (!priceId) {
      return { ok: false, error: `The ${definition.name} plan is not configured yet.` };
    }

    const stripe = getStripe();
    const supabase = createClient();

    let customerId = session.organization.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: session.organization.name,
        email: session.profile.email,
        metadata: { org_id: session.organization.id },
      });
      customerId = customer.id;
      await supabase
        .from('organizations')
        .update({ stripe_customer_id: customerId })
        .eq('id', session.organization.id);
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl()}/settings/billing?checkout=success`,
      cancel_url: `${appUrl()}/settings/billing?checkout=cancelled`,
      // The webhook reads these to know which org to credit.
      subscription_data: {
        metadata: { org_id: session.organization.id, plan: definition.id },
      },
      metadata: { org_id: session.organization.id, plan: definition.id },
      allow_promotion_codes: true,
    });

    if (!checkout.url) return { ok: false, error: 'Stripe did not return a checkout link.' };
    return { ok: true, url: checkout.url };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Send the owner to the Stripe customer portal to manage their card. */
export async function openBillingPortal(): Promise<ActionResult> {
  try {
    const session = await requireRole('owner');
    if (!session.organization.stripe_customer_id) {
      return { ok: false, error: 'There is no subscription to manage yet.' };
    }

    const stripe = getStripe();
    const portal = await stripe.billingPortal.sessions.create({
      customer: session.organization.stripe_customer_id,
      return_url: `${appUrl()}/settings/billing`,
    });

    return { ok: true, url: portal.url };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
