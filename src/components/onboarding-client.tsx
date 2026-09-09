'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Loader2, ArrowRight, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { updateEntity } from '@/app/actions/settings';
import { bulkCreateHolders } from '@/app/actions/holders';
import {
  HOLDER_TYPES, HOLDER_TYPE_LABELS,
  type Entity, type HolderType, type Profile,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const EMIRATES = [
  'Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman',
  'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah',
];

const STEPS = [
  { n: 1, title: 'Your company', blurb: 'So renewals reference the right licence.' },
  { n: 2, title: 'People & assets', blurb: 'Paste them straight from your spreadsheet.' },
  { n: 3, title: 'First documents', blurb: 'Sanad reads the dates for you.' },
];

interface Props {
  entity: Entity;
  team: Profile[];
  holderCount: number;
  documentCount: number;
  initialStep: number;
}

export function OnboardingClient({
  entity, team, holderCount, documentCount, initialStep,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [pending, startTransition] = useTransition();
  const [bulkText, setBulkText] = useState('');
  const [bulkType, setBulkType] = useState<HolderType>('employee');
  const [addedCount, setAddedCount] = useState(holderCount);

  function saveEntity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('entity_id', entity.id);
    startTransition(async () => {
      const res = await updateEntity(formData);
      if (!res.ok) { toast.error(res.error ?? 'Could not save.'); return; }
      toast.success('Saved.');
      setStep(2);
      router.refresh();
    });
  }

  function saveHolders() {
    startTransition(async () => {
      const res = await bulkCreateHolders(entity.id, bulkText, bulkType);
      if (!res.ok) { toast.error(res.error ?? 'Could not add.'); return; }
      toast.success(`Added ${res.created}.`);
      setAddedCount((c) => c + (res.created ?? 0));
      setBulkText('');
      setStep(3);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Set up your register</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Three steps, about ten minutes. You can leave and pick this up later -
          nothing is lost.
        </p>
      </div>

      {/* Step rail. Completed steps stay clickable so this is genuinely
          resumable rather than a one-way wizard. */}
      <ol className="flex gap-2">
        {STEPS.map((s) => {
          const done =
            (s.n === 1 && Boolean(entity.trade_licence_number)) ||
            (s.n === 2 && addedCount > 0) ||
            (s.n === 3 && documentCount > 0);
          const active = step === s.n;
          return (
            <li key={s.n} className="flex-1">
              <button
                type="button"
                onClick={() => setStep(s.n)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                  active ? 'border-primary bg-primary/5' : 'hover:bg-muted/60',
                )}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-ok" />
                  ) : (
                    <span className="tabular-nums text-muted-foreground">{s.n}.</span>
                  )}
                  {s.title}
                </span>
                <span className="mt-0.5 block text-2xs text-muted-foreground">{s.blurb}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <form onSubmit={saveEntity} className="space-y-4 rounded-lg border p-5">
          <div className="space-y-1">
            <Label htmlFor="name">Company name</Label>
            <Input id="name" name="name" required defaultValue={entity.name} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="trade_licence_number">Trade licence number</Label>
              <Input
                id="trade_licence_number"
                name="trade_licence_number"
                defaultValue={entity.trade_licence_number ?? ''}
                placeholder="123456"
              />
            </div>
            <div className="space-y-1">
              <Label>Emirate</Label>
              <Select name="emirate" defaultValue={entity.emirate ?? ''}>
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  {EMIRATES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Who gets chased if a reminder is ignored</Label>
            <Select name="escalation_user_id" defaultValue={entity.escalation_user_id ?? ''}>
              <SelectTrigger><SelectValue placeholder="Choose a person" /></SelectTrigger>
              <SelectContent>
                {team.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-2xs text-muted-foreground">
              Usually the person who signs off renewals.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save and continue
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep(2)}>Skip</Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-4 rounded-lg border p-5">
          <div>
            <h2 className="text-sm font-semibold">Who and what holds documents?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Staff, vehicles, offices, machinery. Open your spreadsheet, select
              the name and staff-number columns, and paste them here.
            </p>
          </div>

          <div className="space-y-1">
            <Label>These are mostly</Label>
            <Select value={bulkType} onValueChange={(v) => setBulkType(v as HolderType)}>
              <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HOLDER_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{HOLDER_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="paste">Paste your list</Label>
            <Textarea
              id="paste"
              rows={9}
              className="font-mono text-xs"
              placeholder={'Fatima Al Marzooqi, EMP-001\nRajesh Kumar, EMP-002\nToyota Hilux, D-48219, vehicle'}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            <p className="text-2xs text-muted-foreground">
              Name, identifier, type - one per line. A header row is ignored.
            </p>
          </div>

          {addedCount > 0 && (
            <p className="text-xs text-ok-ink">
              {addedCount} already added.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={saveHolders} disabled={pending || !bulkText.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              Add and continue
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep(3)}>Skip</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 rounded-lg border p-5">
          <div>
            <h2 className="text-sm font-semibold">Add your first documents</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload a trade licence or a couple of visas. Sanad reads the expiry
              date off each one and asks you to confirm it before saving.
            </p>
          </div>

          {documentCount > 0 ? (
            <p className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok-ink">
              {documentCount} {documentCount === 1 ? 'document' : 'documents'} in your
              register already. You are set up.
            </p>
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Start with the documents that expire soonest. You do not need to
              upload everything today.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild>
              <Link href="/upload"><Upload />Upload documents</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Go to my dashboard<ArrowRight /></Link>
            </Button>
          </div>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        <Link href="/" className="hover:underline">Skip setup and go to the dashboard</Link>
      </p>
    </div>
  );
}
