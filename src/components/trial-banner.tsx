import Link from 'next/link';
import { AlertTriangle, Clock } from 'lucide-react';
import { daysUntil } from '@/lib/dates';
import type { OrgStatus } from '@/lib/types';

/**
 * Only shown when there is something to act on. A permanent "you are on a
 * trial" strip is noise, and this audience has enough of that already.
 */
export function TrialBanner({
  status, trialEndsAt, isOwner,
}: { status: OrgStatus; trialEndsAt: string | null; isOwner: boolean }) {
  if (status === 'active') return null;

  if (status === 'past_due' || status === 'cancelled') {
    return (
      <div className="flex items-center gap-2 border-b bg-danger-soft px-4 py-2 text-sm text-danger-ink">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          {status === 'past_due'
            ? 'Your last payment failed. Alerts are still sending, but update your card to avoid interruption.'
            : 'Your subscription is cancelled. Your data is safe and read-only.'}
        </span>
        {isOwner && (
          <Link href="/settings/billing" className="ml-auto shrink-0 font-medium underline">
            Fix billing
          </Link>
        )}
      </div>
    );
  }

  if (status !== 'trialing' || !trialEndsAt) return null;

  const daysLeft = daysUntil(trialEndsAt.slice(0, 10));
  if (daysLeft > 7) return null; // Nothing useful to say yet.

  return (
    <div className="flex items-center gap-2 border-b bg-warn-soft px-4 py-2 text-sm text-warn-ink">
      <Clock className="h-4 w-4 shrink-0" />
      <span>
        {daysLeft <= 0
          ? 'Your trial has ended.'
          : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in your trial.`}
      </span>
      {isOwner && (
        <Link href="/settings/billing" className="ml-auto shrink-0 font-medium underline">
          Choose a plan
        </Link>
      )}
    </div>
  );
}
