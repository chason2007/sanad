'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, CreditCard, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { openBillingPortal, startCheckout } from '@/app/actions/billing';
import { PLANS, planById } from '@/lib/plans';
import { formatDate } from '@/lib/dates';
import type { Organization } from '@/lib/types';
import { cn } from '@/lib/utils';

export function BillingSettings({
  organization, documentCount, entityCount,
}: { organization: Organization; documentCount: number; entityCount: number }) {
  const [pending, startTransition] = useTransition();
  const current = planById(organization.plan);

  function choosePlan(planId: typeof current.id) {
    startTransition(async () => {
      const res = await startCheckout(planId);
      if (!res.ok || !res.url) { toast.error(res.error ?? 'Could not start checkout.'); return; }
      window.location.href = res.url;
    });
  }

  function manage() {
    startTransition(async () => {
      const res = await openBillingPortal();
      if (!res.ok || !res.url) { toast.error(res.error ?? 'Could not open the billing portal.'); return; }
      window.location.href = res.url;
    });
  }

  const usage = [
    { label: 'Documents', used: documentCount, limit: organization.document_limit },
    { label: 'Companies', used: entityCount, limit: organization.entity_limit },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Your plan</h2>
          <Badge variant={organization.status === 'past_due' ? 'expired' : 'outline'}>
            {organization.status === 'trialing' ? 'Trial' : organization.status}
          </Badge>
          {organization.stripe_customer_id && (
            <Button
              variant="outline" size="sm" className="ml-auto"
              onClick={manage} disabled={pending}
            >
              {pending ? <Loader2 className="animate-spin" /> : <CreditCard />}
              Manage billing<ExternalLink className="h-3 w-3" />
            </Button>
          )}
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Current</p>
            <p className="mt-0.5 text-lg font-semibold">{current.name}</p>
            {organization.status === 'trialing' && organization.trial_ends_at && (
              <p className="text-xs text-muted-foreground">
                Trial ends {formatDate(organization.trial_ends_at.slice(0, 10))}
              </p>
            )}
          </div>

          {usage.map((row) => {
            const pct = row.limit > 0 ? Math.min((row.used / row.limit) * 100, 100) : 0;
            const tight = pct >= 80;
            return (
              <div key={row.label}>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">
                  {row.used}
                  <span className="text-sm font-normal text-muted-foreground"> / {row.limit}</span>
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', tight ? 'bg-warn' : 'bg-primary')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Plans</h2>
        <div className="grid gap-3 lg:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent = plan.id === organization.plan && organization.status === 'active';
            return (
              <div
                key={plan.id}
                className={cn(
                  'flex flex-col rounded-lg border p-4',
                  isCurrent && 'border-primary ring-1 ring-primary/20',
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{plan.name}</h3>
                  {isCurrent && <Badge variant="ok">Current</Badge>}
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  AED {plan.priceAed}
                  <span className="text-sm font-normal text-muted-foreground">/month</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{plan.blurb}</p>

                <ul className="mt-3 flex-1 space-y-1.5 text-xs">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-1.5">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Button
                  className="mt-4"
                  variant={isCurrent ? 'outline' : 'default'}
                  disabled={pending || isCurrent}
                  onClick={() => choosePlan(plan.id)}
                >
                  {pending && <Loader2 className="animate-spin" />}
                  {isCurrent ? 'Your plan' : `Choose ${plan.name}`}
                </Button>
              </div>
            );
          })}
        </div>
        <p className="text-2xs text-muted-foreground">
          Prices exclude VAT. Cancelling keeps your register readable - your
          documents are never deleted because a card expired.
        </p>
      </section>
    </div>
  );
}
