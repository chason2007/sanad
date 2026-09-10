import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { planForPriceId, planById } from '@/lib/plans';
import { log } from '@/lib/privacy';
import type { OrgStatus } from '@/lib/types';

/**
 * Stripe webhook.
 *
 * This is the ONLY place that changes what a customer is entitled to. The
 * signature is verified against the raw body before anything is trusted -
 * without that check this endpoint is an open door to a free plan upgrade
 * for anyone who can POST JSON.
 *
 * Runs on the service-role client because there is no user session behind
 * a webhook, and it is excluded from the auth middleware for the same
 * reason.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });
  }

  // Must be the raw body - a parsed-and-restringified payload will not
  // match the signature.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    log.error('stripe', 'signature verification failed', err);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.org_id;
        if (orgId && session.subscription) {
          await syncSubscription(supabase, String(session.subscription), orgId);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscription(supabase, subscription.id, subscription.metadata?.org_id);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = String(invoice.customer);
        await supabase
          .from('organizations')
          .update({ status: 'past_due' satisfies OrgStatus })
          .eq('stripe_customer_id', customerId);
        break;
      }

      default:
        // Unhandled event types are acknowledged, not errored - returning a
        // non-2xx makes Stripe retry something we will never handle.
        break;
    }
  } catch (err) {
    log.error('stripe', `handler failed for ${event.type}`, err);
    // 500 so Stripe retries: a dropped subscription update means a customer
    // paying for a plan they cannot use.
    return NextResponse.json({ error: 'Handler failed.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

const STATUS_MAP: Record<string, OrgStatus> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'cancelled',
  incomplete: 'past_due',
  incomplete_expired: 'cancelled',
  paused: 'past_due',
};

async function syncSubscription(
  supabase: ReturnType<typeof createAdminClient>,
  subscriptionId: string,
  orgIdHint?: string | null,
) {
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const customerId = String(subscription.customer);

  const priceId = subscription.items.data[0]?.price?.id;
  const plan = priceId ? planForPriceId(priceId) : null;
  const resolved = plan ?? planById('starter');

  const status = STATUS_MAP[subscription.status] ?? 'past_due';
  const cancelled = status === 'cancelled';

  const update = {
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId,
    status,
    plan: resolved.id,
    // A cancelled subscription keeps the data readable but stops the org
    // growing past the entry plan.
    document_limit: cancelled ? planById('starter').documentLimit : resolved.documentLimit,
    entity_limit: cancelled ? planById('starter').entityLimit : resolved.entityLimit,
  };

  // Prefer the org id carried on the subscription metadata; fall back to
  // the customer id, which is stamped on the org at checkout.
  const query = orgIdHint
    ? supabase.from('organizations').update(update).eq('id', orgIdHint)
    : supabase.from('organizations').update(update).eq('stripe_customer_id', customerId);

  const { error } = await query;
  if (error) throw new Error(error.message);
}
