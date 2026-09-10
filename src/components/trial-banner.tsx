import Link from 'next/link';
import { AlertTriangle, Clock, BellOff } from 'lucide-react';
import { daysUntil } from '@/lib/dates';
import { entitlementsFor, isNearLimit } from '@/lib/billing';
import type { Organization } from '@/lib/types';

/**
 * The one strip at the top of the app that says something is wrong with
 * billing - and, crucially, says what is still working.
 *
 * A customer whose card just failed needs to know that their compliance
 * reminders are still going out. Left to guess, they assume the worst and
 * either panic or stop trusting the product. Neither is what we want, and
 * the truth is reassuring, so we say it plainly.
 *
 * Shown only when there is something to act on. A permanent "you are on a
 * trial" strip is noise, and this audience has enough of that.
 */
export function TrialBanner({
  organization, isOwner, documentCount,
}: {
  organization: Organization;
  isOwner: boolean;
  documentCount?: number;
}) {
  const ent = entitlementsFor(organization);

  if (ent.state === 'grace') {
    return (
      <Strip tone="danger" icon={<AlertTriangle className="h-4 w-4 shrink-0" />} isOwner={isOwner}>
        <strong>{organization.status === 'past_due' ? 'Your last payment failed.' : 'Your subscription is cancelled.'}</strong>{' '}
        Reminders keep sending for {ent.graceDaysRemaining} more{' '}
        {ent.graceDaysRemaining === 1 ? 'day' : 'days'}, and everything already in
        your register can still be renewed and updated. You cannot add new
        documents until billing is fixed.
      </Strip>
    );
  }

  if (ent.state === 'lapsed') {
    return (
      <Strip tone="danger" icon={<BellOff className="h-4 w-4 shrink-0" />} isOwner={isOwner}>
        <strong>Reminders are paused.</strong> The subscription has been unpaid for
        over 30 days. Your register is still here and still readable — restart the
        subscription and reminders resume immediately.
      </Strip>
    );
  }

  // Healthy. Two things can still be worth saying.
  if (
    documentCount != null &&
    isNearLimit(documentCount, organization.document_limit)
  ) {
    return (
      <Strip tone="warn" icon={<Clock className="h-4 w-4 shrink-0" />} isOwner={isOwner} label="See plans">
        You have used {documentCount} of your {organization.document_limit.toLocaleString('en-AE')} documents.
        Worth upgrading before you hit the limit mid-upload.
      </Strip>
    );
  }

  if (organization.status === 'trialing' && organization.trial_ends_at) {
    const daysLeft = daysUntil(organization.trial_ends_at.slice(0, 10));
    if (daysLeft > 7) return null; // Nothing useful to say yet.
    return (
      <Strip tone="warn" icon={<Clock className="h-4 w-4 shrink-0" />} isOwner={isOwner} label="Choose a plan">
        {daysLeft <= 0
          ? 'Your trial has ended.'
          : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in your trial.`}
      </Strip>
    );
  }

  return null;
}

function Strip({
  tone, icon, children, isOwner, label = 'Fix billing',
}: {
  tone: 'danger' | 'warn';
  icon: React.ReactNode;
  children: React.ReactNode;
  isOwner: boolean;
  label?: string;
}) {
  const cls =
    tone === 'danger'
      ? 'border-b bg-danger-soft text-danger-ink'
      : 'border-b bg-warn-soft text-warn-ink';

  return (
    <div className={`flex flex-wrap items-center gap-2 px-4 py-2 text-sm ${cls}`}>
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {isOwner && (
        <Link href="/settings/billing" className="shrink-0 font-medium underline">
          {label}
        </Link>
      )}
    </div>
  );
}
