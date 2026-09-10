'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, Loader2, Save, ArrowRight, Clock, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RenewDialog } from '@/components/renew-dialog';
import { getSignedFileUrl, updateDocument } from '@/app/actions/documents';
import { daysUntil, describeDays, formatDate, formatDateTime, urgencyFor } from '@/lib/dates';
import { URGENCY_LABEL } from '@/lib/register';
import {
  HOLDER_TYPE_LABELS,
  type DocumentType, type Holder, type Profile, type RegisterRow,
} from '@/lib/types';
import { cn, NONE_VALUE } from '@/lib/utils';

interface AlertRecord {
  id: string;
  lead_day: number;
  channel: string;
  sent_at: string | null;
  delivery_status: string;
  acknowledged_at: string | null;
  escalated_at: string | null;
  recipient?: { full_name: string | null; email: string } | null;
}

interface Props {
  row: RegisterRow;
  documentType: DocumentType | null;
  chain: RegisterRow[];
  alerts: AlertRecord[];
  holders: Holder[];
  team: Profile[];
  canWrite: boolean;
  canDownload: boolean;
}

export function DocumentDetail({
  row, documentType, chain, alerts, holders, team, canWrite, canDownload,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const days = daysUntil(row.expiry_date);
  const urgency = urgencyFor(days);
  const isHistory = row.status === 'renewed' || row.status === 'archived';

  async function openFile() {
    const res = await getSignedFileUrl(row.id);
    if (!res.ok || !res.url) { toast.error(res.error ?? 'Could not open the file.'); return; }
    window.open(res.url, '_blank', 'noopener,noreferrer');
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('document_id', row.id);
    startTransition(async () => {
      const res = await updateDocument(formData);
      if (!res.ok) { toast.error(res.error ?? 'Could not save.'); return; }
      toast.success('Saved.');
      router.refresh();
    });
  }

  const checklist = documentType?.renewal_checklist;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{row.document_type_label}</h1>
            {isHistory ? (
              <Badge>{row.status === 'renewed' ? 'Renewed' : 'Archived'}</Badge>
            ) : (
              <Badge variant={urgency}>{URGENCY_LABEL[urgency]}</Badge>
            )}
            {row.needs_review && <Badge variant="soon">Needs review</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {row.holder_name ? (
              <Link href={`/holders/${row.holder_id}`} className="hover:underline">{row.holder_name}</Link>
            ) : (
              row.entity_name
            )}
            {row.holder_type && ` · ${HOLDER_TYPE_LABELS[row.holder_type]}`}
            {row.holder_identifier && ` · ${row.holder_identifier}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {row.file_path && canDownload && (
            <Button variant="outline" size="sm" onClick={openFile}><Eye />View file</Button>
          )}
          {canWrite && !isHistory && (
            <RenewDialog
              documentId={row.id}
              documentLabel={row.document_type_label}
              holderName={row.holder_name}
              currentExpiry={row.expiry_date}
              trigger={<Button size="sm">Mark renewed</Button>}
            />
          )}
        </div>
      </div>

      {/* The number the user came here for, stated plainly. */}
      <div
        className={cn(
          'rounded-lg border px-4 py-3',
          urgency === 'expired' && !isHistory && 'border-danger/30 bg-danger-soft',
          urgency === 'critical' && !isHistory && 'border-danger/20 bg-danger-soft/60',
          urgency === 'soon' && !isHistory && 'border-warn/30 bg-warn-soft',
        )}
      >
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Expires</span>
        <p className="mt-0.5 text-2xl font-semibold tabular-nums">{formatDate(row.expiry_date)}</p>
        <p className="text-sm">
          {isHistory ? 'This document has been superseded.' : describeDays(days)}
          {documentType?.typical_lead_time_days && !isHistory && days >= 0 && (
            <span className="text-muted-foreground">
              {' '}· renewals typically take {documentType.typical_lead_time_days} days
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-lg border">
            <h2 className="border-b px-4 py-2.5 text-sm font-semibold">Details</h2>
            <form onSubmit={onSubmit} className="grid gap-3 p-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Expiry date</Label>
                <Input name="expiry_date" type="date" required defaultValue={row.expiry_date} disabled={!canWrite} />
              </div>
              <div className="space-y-1">
                <Label>Issue date</Label>
                <Input name="issue_date" type="date" defaultValue={row.issue_date ?? ''} disabled={!canWrite} />
              </div>
              <div className="space-y-1">
                <Label>Document number</Label>
                <Input name="document_number" defaultValue={row.document_number ?? ''} disabled={!canWrite} />
              </div>
              <div className="space-y-1">
                <Label>Belongs to</Label>
                <Select name="holder_id" defaultValue={row.holder_id ?? NONE_VALUE} disabled={!canWrite}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>The company itself</SelectItem>
                    {holders.map((holder) => (
                      <SelectItem key={holder.id} value={holder.id}>{holder.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Responsible</Label>
                <Select name="responsible_user_id" defaultValue={row.responsible_user_id ?? ''} disabled={!canWrite}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    {team.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.full_name || person.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Entity</Label>
                <Input value={row.entity_name} disabled readOnly />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea name="notes" rows={2} defaultValue={row.notes ?? ''} disabled={!canWrite} />
              </div>
              {canWrite && (
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm" disabled={pending}>
                    {pending ? <Loader2 className="animate-spin" /> : <Save />}
                    Save changes
                  </Button>
                </div>
              )}
            </form>
          </section>

          {chain.length > 1 && (
            <section className="rounded-lg border">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold">
                Renewal history
                <span className="ml-2 font-normal text-muted-foreground">
                  {chain.length} versions
                </span>
              </h2>
              <ol className="divide-y">
                {chain.map((link, index) => {
                  const isCurrent = link.id === row.id;
                  return (
                    <li
                      key={link.id}
                      className={cn('flex items-center gap-3 px-4 py-2.5 text-sm', isCurrent && 'bg-muted/60')}
                    >
                      <span className="w-6 shrink-0 text-2xs tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="tabular-nums">
                        {link.issue_date ? `${formatDate(link.issue_date)} ` : ''}
                        <ArrowRight className="inline h-3 w-3 text-muted-foreground" />{' '}
                        {formatDate(link.expiry_date)}
                      </span>
                      {link.document_number && (
                        <span className="truncate font-mono text-2xs text-muted-foreground">
                          {link.document_number}
                        </span>
                      )}
                      <span className="ml-auto shrink-0">
                        {isCurrent ? (
                          <Badge variant="outline">Viewing</Badge>
                        ) : (
                          <Link href={`/documents/${link.id}`} className="text-xs text-muted-foreground hover:underline">
                            Open <ExternalLink className="inline h-3 w-3" />
                          </Link>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <section className="rounded-lg border">
            <h2 className="border-b px-4 py-2.5 text-sm font-semibold">Alert history</h2>
            {alerts.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No alerts sent yet for this document.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-2xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-1.5 text-left font-medium">When</th>
                    <th className="px-2 py-1.5 text-left font-medium">Lead</th>
                    <th className="px-2 py-1.5 text-left font-medium">To</th>
                    <th className="px-2 py-1.5 text-left font-medium">Channel</th>
                    <th className="px-4 py-1.5 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {alerts.map((alert) => (
                    <tr key={alert.id}>
                      <td className="whitespace-nowrap px-4 py-1.5 tabular-nums">
                        {formatDateTime(alert.sent_at)}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {alert.lead_day === 0 ? 'On the day' : `${alert.lead_day}d`}
                      </td>
                      <td className="truncate px-2 py-1.5">
                        {alert.recipient?.full_name || alert.recipient?.email || '--'}
                      </td>
                      <td className="px-2 py-1.5 capitalize">{alert.channel}</td>
                      <td className="px-4 py-1.5">
                        {alert.acknowledged_at ? (
                          <Badge variant="ok">Acknowledged</Badge>
                        ) : alert.escalated_at ? (
                          <Badge variant="expired">Escalated</Badge>
                        ) : (
                          <Badge variant="outline" className="capitalize">{alert.delivery_status}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        {/* The renewal checklist - the part that is not in the spreadsheet. */}
        <aside className="space-y-4">
          {checklist && checklist.steps.length > 0 && (
            <section className="rounded-lg border">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold">
                How to renew this
              </h2>
              <ol className="divide-y">
                {checklist.steps.map((step, index) => (
                  <li key={step.title} className="px-4 py-3">
                    <p className="flex gap-2 text-sm font-medium">
                      <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
                      {step.title}
                    </p>
                    <p className="ml-5 mt-1 text-xs text-muted-foreground">{step.detail}</p>
                    {step.where && (
                      <p className="ml-5 mt-1 text-2xs uppercase tracking-wide text-muted-foreground">
                        {step.where}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
              {checklist.documents_required.length > 0 && (
                <div className="border-t px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Bring with you
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs">
                    {checklist.documents_required.map((doc) => (
                      <li key={doc} className="flex gap-1.5">
                        <span className="text-muted-foreground">·</span>{doc}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {(documentType?.typical_cost_aed || documentType?.typical_lead_time_days) && (
            <section className="rounded-lg border p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Clock className="h-3.5 w-3.5" />Typical renewal
              </h2>
              <dl className="space-y-1.5 text-sm">
                {documentType.typical_lead_time_days != null && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Lead time</dt>
                    <dd className="tabular-nums">{documentType.typical_lead_time_days} days</dd>
                  </div>
                )}
                {documentType.typical_cost_aed != null && Number(documentType.typical_cost_aed) > 0 && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Cost</dt>
                    <dd className="tabular-nums">
                      AED {Number(documentType.typical_cost_aed).toLocaleString('en-AE')}
                    </dd>
                  </div>
                )}
              </dl>
              <p className="mt-2 text-2xs text-muted-foreground">
                Indicative only. Government fees change.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
