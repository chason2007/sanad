'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { acknowledgeViaToken, renewViaToken } from '@/app/a/[token]/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The action buttons on the emailed reminder page.
 *
 * Sized for a thumb: this is opened on a phone, standing in a corridor,
 * by someone who has not signed in and does not intend to.
 */
export function AlertActionPanel({
  token, action, currentExpiry, alreadyAcknowledged, alreadyRenewed,
}: {
  token: string;
  action: 'acknowledge' | 'renew';
  currentExpiry: string;
  alreadyAcknowledged: boolean;
  alreadyRenewed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (alreadyRenewed) {
    return (
      <Result tone="ok">
        This document has already been renewed. Nothing more to do.
      </Result>
    );
  }
  if (done) return <Result tone="ok">{done}</Result>;

  function acknowledge() {
    setError(null);
    startTransition(async () => {
      const result = await acknowledgeViaToken(token);
      if (!result.ok) { setError(result.error ?? 'Something went wrong.'); return; }
      setDone(result.message ?? 'Acknowledged.');
    });
  }

  function renew(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await renewViaToken(token, formData);
      if (!result.ok) { setError(result.error ?? 'Something went wrong.'); return; }
      setDone(result.message ?? 'Saved.');
    });
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-5">
      {action === 'renew' ? (
        <form onSubmit={renew} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new_expiry_date">New expiry date</Label>
            <Input
              id="new_expiry_date"
              name="new_expiry_date"
              type="date"
              required
              min={currentExpiry}
              className="h-11 text-base"
            />
            <p className="text-xs text-muted-foreground">
              The current document is kept in the history.
            </p>
          </div>
          <Button type="submit" className="h-11 w-full text-base" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Save the new expiry date
          </Button>
        </form>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Acknowledging tells Sanad you have seen this, so it will not be
            escalated to your manager.
          </p>
          <Button
            onClick={acknowledge}
            className="h-11 w-full text-base"
            disabled={pending || alreadyAcknowledged}
          >
            {pending && <Loader2 className="animate-spin" />}
            {alreadyAcknowledged ? 'Already acknowledged' : 'Acknowledge'}
          </Button>
        </>
      )}

      {error && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-ink">{error}</p>
      )}
    </div>
  );
}

function Result({ tone, children }: { tone: 'ok'; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-ok/30 bg-ok-soft p-4 text-ok-ink">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="text-sm">{children}</p>
    </div>
  );
}
