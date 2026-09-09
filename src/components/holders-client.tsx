'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { bulkCreateHolders, createHolder } from '@/app/actions/holders';
import { daysUntil, urgencyFor } from '@/lib/dates';
import {
  HOLDER_TYPES, HOLDER_TYPE_LABELS,
  type Entity, type Holder, type HolderType, type RegisterRow,
} from '@/lib/types';

const ALL = '__all__';

interface Props {
  holders: Holder[];
  rows: RegisterRow[];
  entities: Entity[];
  canWrite: boolean;
}

export function HoldersClient({ holders, rows, entities, canWrite }: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>(ALL);

  // One pass over the register keyed by holder, so each row can show the
  // count and the soonest expiry without a query per person.
  const byHolder = useMemo(() => {
    const map = new Map<string, { total: number; soonest: RegisterRow | null; expired: number }>();
    for (const row of rows) {
      if (!row.holder_id) continue;
      if (row.status === 'renewed' || row.status === 'archived') continue;
      const entry = map.get(row.holder_id) ?? { total: 0, soonest: null, expired: 0 };
      entry.total += 1;
      if (daysUntil(row.expiry_date) < 0) entry.expired += 1;
      if (!entry.soonest || row.expiry_date < entry.soonest.expiry_date) entry.soonest = row;
      map.set(row.holder_id, entry);
    }
    return map;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return holders
      .filter((h) => (typeFilter === ALL ? true : h.holder_type === typeFilter))
      .filter((h) =>
        !needle ||
        h.name.toLowerCase().includes(needle) ||
        (h.identifier ?? '').toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [holders, search, typeFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">People &amp; assets</h1>
          <p className="text-sm text-muted-foreground">
            {visible.length} of {holders.length} tracked.
          </p>
        </div>
        {canWrite && <AddHolders entities={entities} />}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by name or staff number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {HOLDER_TYPES.map((type) => (
              <SelectItem key={type} value={type}>{HOLDER_TYPE_LABELS[type]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed py-14 text-center">
          <Users className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            {holders.length === 0
              ? 'No people or assets yet. Paste a list from your spreadsheet to get started.'
              : 'Nobody matches that search.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b bg-muted/50 text-2xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-2 py-2 text-left font-medium">Type</th>
                <th className="px-2 py-2 text-left font-medium">Identifier</th>
                <th className="px-2 py-2 text-left font-medium">Documents</th>
                <th className="px-3 py-2 text-left font-medium">Next expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((holder) => {
                const stats = byHolder.get(holder.id);
                const soonest = stats?.soonest;
                const urgency = soonest ? urgencyFor(daysUntil(soonest.expiry_date)) : null;

                return (
                  <tr key={holder.id} className="hover:bg-muted/50">
                    <td className="px-3 py-1.5">
                      <Link href={`/holders/${holder.id}`} className="font-medium hover:underline">
                        {holder.name}
                      </Link>
                      {!holder.active && (
                        <span className="ml-2 text-2xs text-muted-foreground">inactive</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {HOLDER_TYPE_LABELS[holder.holder_type]}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-2xs text-muted-foreground">
                      {holder.identifier ?? '--'}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {stats?.total ?? 0}
                      {stats?.expired ? (
                        <span className="ml-1.5 text-2xs text-danger-ink">
                          ({stats.expired} expired)
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      {soonest && urgency ? (
                        <span className="flex items-center gap-2">
                          <Badge variant={urgency}>{soonest.document_type_label}</Badge>
                          <span className="tabular-nums text-muted-foreground">
                            {soonest.expiry_date}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddHolders({ entities }: { entities: Entity[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'one' | 'many'>('one');
  const [pending, startTransition] = useTransition();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? '');
  const [bulkText, setBulkText] = useState('');
  const [bulkType, setBulkType] = useState<HolderType>('employee');

  function addOne(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('entity_id', entityId);
    startTransition(async () => {
      const res = await createHolder(formData);
      if (!res.ok) { toast.error(res.error ?? 'Could not add.'); return; }
      toast.success('Added.');
      setOpen(false);
      router.refresh();
    });
  }

  function addMany() {
    startTransition(async () => {
      const res = await bulkCreateHolders(entityId, bulkText, bulkType);
      if (!res.ok) { toast.error(res.error ?? 'Could not add.'); return; }
      toast.success(
        `Added ${res.created}.${res.skipped?.length ? ` Skipped ${res.skipped.length}.` : ''}`,
      );
      if (res.skipped?.length) {
        res.skipped.slice(0, 5).forEach((s) => toast.warning(s));
      }
      setBulkText('');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus />Add people or assets</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add people or assets</DialogTitle>
          <DialogDescription>
            Anything that holds a document with an expiry date: staff, vehicles,
            offices, machinery.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-md bg-muted p-1">
          {(['one', 'many'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`flex-1 rounded px-3 py-1 text-sm transition-colors ${
                mode === value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {value === 'one' ? 'One at a time' : 'Paste a list'}
            </button>
          ))}
        </div>

        {entities.length > 1 && (
          <div className="space-y-1">
            <Label>Company</Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {entities.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {mode === 'one' ? (
          <form onSubmit={addOne} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="holder-name">Name</Label>
              <Input id="holder-name" name="name" required autoFocus placeholder="Rajesh Kumar" />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select name="holder_type" defaultValue="employee">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOLDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{HOLDER_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="holder-identifier">Staff number, plate or unit</Label>
              <Input id="holder-identifier" name="identifier" placeholder="EMP-014" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}Add
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Default type</Label>
              <Select value={bulkType} onValueChange={(v) => setBulkType(v as HolderType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOLDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{HOLDER_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk">Paste from your spreadsheet</Label>
              <Textarea
                id="bulk"
                rows={8}
                className="font-mono text-xs"
                placeholder={'Rajesh Kumar, EMP-014\nFatima Al Marzooqi, EMP-015\nToyota Hilux, D-48219, vehicle'}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
              />
              <p className="text-2xs text-muted-foreground">
                One per line: name, identifier, type. Commas or tabs both work,
                and a header row is ignored.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={addMany} disabled={pending || !bulkText.trim()}>
                {pending && <Loader2 className="animate-spin" />}
                Add {bulkText.split(/\r?\n/).filter((l) => l.trim()).length || ''} rows
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
