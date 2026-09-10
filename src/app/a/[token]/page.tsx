import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyAlertToken } from '@/lib/alerts/tokens';
import { Brand } from '@/components/brand';
import { AlertActionPanel } from '@/components/alert-action-panel';
import { formatDate, daysUntil, describeDays } from '@/lib/dates';
import type { RegisterRow } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Document reminder' };

/**
 * The page an alert email links to.
 *
 * Renders read-only. Nothing here mutates anything - the buttons post to a
 * Server Action - because mail scanners fetch these URLs unprompted and an
 * acknowledgement triggered by a spam filter would defeat escalation.
 */
export default async function AlertActionPage({
  params,
}: {
  params: { token: string };
}) {
  const verified = verifyAlertToken(params.token);

  if (!verified.ok) {
    return (
      <Shell>
        <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-danger-ink">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">
              {verified.reason === 'expired' ? 'This link has expired' : 'This link is not valid'}
            </p>
            <p className="mt-1 text-sm">
              {verified.reason === 'expired'
                ? 'Reminder links stop working after 60 days. Sign in to Sanad to see the document.'
                : 'It may have been altered in transit, or the reminder was removed.'}
            </p>
          </div>
        </div>
        <SignInLink />
      </Shell>
    );
  }

  const supabase = createAdminClient();

  const { data: alert } = await supabase
    .from('alerts')
    .select('id, document_id, lead_day, acknowledged_at, sent_at')
    .eq('id', verified.payload.a)
    .maybeSingle();

  const { data: document } = alert
    ? await supabase.from('document_register').select('*').eq('id', alert.document_id).maybeSingle()
    : { data: null };

  if (!alert || !document) {
    return (
      <Shell>
        <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          This reminder is no longer available. It may have been removed.
        </p>
        <SignInLink />
      </Shell>
    );
  }

  const row = document as RegisterRow;
  const days = daysUntil(row.expiry_date);
  const alreadyRenewed = Boolean(row.superseded_by_id) || row.status === 'renewed';

  return (
    <Shell>
      <div className="rounded-lg border bg-card">
        <div className="border-b px-5 py-4">
          <h1 className="text-lg font-semibold tracking-tight">
            {row.document_type_label}
            {row.holder_name ? ` — ${row.holder_name}` : ''}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{row.entity_name}</p>
        </div>

        <dl className="divide-y text-sm">
          {[
            ['Expires', `${formatDate(row.expiry_date)} · ${describeDays(days)}`],
            ...(row.document_number ? [['Number', row.document_number]] : []),
            ...(row.holder_identifier ? [['Identifier', row.holder_identifier]] : []),
            ['Responsible', row.responsible_name ?? 'Unassigned'],
          ].map(([label, value]) => (
            <div key={label} className="flex gap-4 px-5 py-2.5">
              <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <AlertActionPanel
        token={params.token}
        action={verified.payload.t}
        currentExpiry={row.expiry_date}
        alreadyAcknowledged={Boolean(alert.acknowledged_at)}
        alreadyRenewed={alreadyRenewed}
      />

      <SignInLink />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 px-4 py-10">
      <Brand className="mb-2" />
      {children}
    </div>
  );
}

function SignInLink() {
  return (
    <p className="text-center text-xs text-muted-foreground">
      <Link href="/login" className="hover:underline">Sign in to Sanad</Link> to see the full register.
    </p>
  );
}
