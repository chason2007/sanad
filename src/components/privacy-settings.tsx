'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, Loader2, ShieldCheck, Trash2, MapPin, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { deleteOrganization, updateRetention } from '@/app/actions/privacy';
import { DATA_RESIDENCY } from '@/lib/residency';
import type { Organization } from '@/lib/types';

const RETENTION_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
  { value: '730', label: '2 years' },
  { value: '1825', label: '5 years' },
  { value: '3650', label: '10 years' },
];

interface Props {
  organization: Organization;
  isOwner: boolean;
  counts: { documents: number; files: number; holders: number; people: number; entities: number };
}

export function PrivacySettings({ organization, isOwner, counts }: Props) {
  return (
    <div className="space-y-6">
      <Residency />
      <Retention organization={organization} isOwner={isOwner} />
      <Export isOwner={isOwner} counts={counts} />
      {isOwner && <DangerZone organization={organization} counts={counts} />}
    </div>
  );
}

function Section({
  title, description, children, footer,
}: {
  title: string; description: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="p-4">{children}</div>
      {footer && <div className="border-t px-4 py-2.5">{footer}</div>}
    </section>
  );
}

function Residency() {
  const { region, summary, subprocessors, notes } = DATA_RESIDENCY;

  return (
    <Section
      title="Where your data lives"
      description="The answer to the first question on every security questionnaire."
    >
      <div className="flex items-start gap-2.5 rounded-md bg-muted/50 px-3 py-2.5">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">
            {region.city}, {region.country}{' '}
            <span className="font-mono text-2xs text-muted-foreground">{region.code}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>
        </div>
      </div>

      <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Who else touches your data
      </h3>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[38rem] text-xs">
          <thead className="border-b bg-muted/40 text-2xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Service</th>
              <th className="px-2 py-1.5 text-left font-medium">Purpose</th>
              <th className="px-2 py-1.5 text-left font-medium">Location</th>
              <th className="px-3 py-1.5 text-left font-medium">What it sees</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {subprocessors.map((s) => (
              <tr key={s.name}>
                <td className="px-3 py-1.5 font-medium">{s.name}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{s.purpose}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{s.location}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{s.dataSeen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 space-y-1.5">
        {notes.map((note) => (
          <li key={note} className="flex gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
            {note}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Retention({ organization, isOwner }: { organization: Organization; isOwner: boolean }) {
  const router = useRouter();
  const [days, setDays] = useState(String(organization.data_retention_days));
  const [pending, startTransition] = useTransition();
  const dirty = days !== String(organization.data_retention_days);

  function save() {
    startTransition(async () => {
      const res = await updateRetention(Number(days));
      if (!res.ok) { toast.error(res.error ?? 'Could not save.'); return; }
      toast.success('Retention updated.');
      router.refresh();
    });
  }

  return (
    <Section
      title="How long superseded scans are kept"
      description="Once a document is renewed, the old scan stops being necessary."
      footer={
        isOwner && dirty ? (
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />}Save
          </Button>
        ) : undefined
      }
    >
      <div className="max-w-xs space-y-1.5">
        <Label>Keep superseded scans for</Label>
        <Select value={days} onValueChange={setDays} disabled={!isOwner}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {RETENTION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="mt-3 max-w-xl text-xs text-muted-foreground">
        After this, the scan file and the personal data read from it are deleted
        permanently. <strong className="font-medium text-foreground">The register
        row is kept</strong> — dates, document type, holder and the renewal
        chain — so you can still answer what a licence looked like three
        renewals ago without holding on to a picture of someone&apos;s passport.
      </p>
    </Section>
  );
}

function Export({
  isOwner, counts,
}: { isOwner: boolean; counts: Props['counts'] }) {
  const [pending, setPending] = useState(false);

  return (
    <Section
      title="Export everything"
      description="Every record and every scan, in one archive."
    >
      <p className="max-w-xl text-xs text-muted-foreground">
        A ZIP containing every table as JSON, the register as CSV, and{' '}
        {counts.files === 1 ? 'the 1 stored scan' : `all ${counts.files} stored scans`}{' '}
        foldered by company. The archive is not encrypted and contains passport and Emirates
        ID images — put it somewhere appropriate.
      </p>
      <div className="mt-3">
        {isOwner ? (
          <Button asChild onClick={() => setPending(true)} disabled={pending}>
            <a href="/api/export" download>
              {pending ? <Loader2 className="animate-spin" /> : <Download />}
              Download my data
            </a>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Only the owner can export.</p>
        )}
      </div>
    </Section>
  );
}

function DangerZone({
  organization, counts,
}: { organization: Organization; counts: Props['counts'] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, startTransition] = useTransition();
  const matches = confirm === organization.name;

  function remove() {
    const formData = new FormData();
    formData.set('confirm_name', confirm);
    startTransition(async () => {
      const res = await deleteOrganization(formData);
      if (!res.ok) { toast.error(res.error ?? 'Could not delete.'); return; }
      toast.success('Deleted. Signing you out.');
      router.push('/login');
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-danger/40">
      <div className="border-b border-danger/30 bg-danger-soft px-4 py-3">
        <h2 className="text-sm font-semibold text-danger-ink">Delete this organisation</h2>
        <p className="mt-0.5 text-xs text-danger-ink/80">
          Irreversible. There is no undo and no backup we can restore for you.
        </p>
      </div>
      <div className="p-4">
        <p className="max-w-xl text-xs text-muted-foreground">
          This permanently deletes {counts.documents}{' '}
          {counts.documents === 1 ? 'document' : 'documents'}, {counts.files}{' '}
          {counts.files === 1 ? 'scan' : 'scans'}, {counts.holders} people and
          assets, {counts.entities}{' '}
          {counts.entities === 1 ? 'company' : 'companies'} and {counts.people}{' '}
          {counts.people === 1 ? 'user account' : 'user accounts'} — including
          yours. Everyone is signed out immediately and reminders stop.
        </p>
        <p className="mt-2 max-w-xl text-xs text-muted-foreground">
          Export your data first if you might want it.
        </p>

        <Dialog open={open} onOpenChange={(v) => { setOpen(v); setConfirm(''); }}>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm" className="mt-3">
              <Trash2 />Delete organisation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {organization.name}?</DialogTitle>
              <DialogDescription>
                This cannot be undone. {counts.documents}{' '}
                {counts.documents === 1 ? 'document' : 'documents'} and{' '}
                {counts.files} {counts.files === 1 ? 'scan' : 'scans'} will be
                destroyed.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="confirm_name">
                Type <span className="font-mono text-foreground">{organization.name}</span> to confirm
              </Label>
              <Input
                id="confirm_name"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                placeholder={organization.name}
              />
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Keep it
              </Button>
              <Button variant="destructive" onClick={remove} disabled={!matches || pending}>
                {pending && <Loader2 className="animate-spin" />}
                Delete permanently
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
