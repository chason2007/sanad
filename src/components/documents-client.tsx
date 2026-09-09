'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, Loader2, Search, X, Users, Archive } from 'lucide-react';
import { RegisterTable } from '@/components/register-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { applyFilters, sortRows, toCsv, type RegisterFilters, type SortKey } from '@/lib/register';
import { archiveDocuments, reassignDocuments } from '@/app/actions/documents';
import { dubaiToday } from '@/lib/dates';
import {
  HOLDER_TYPES, HOLDER_TYPE_LABELS,
  type DocumentType, type Entity, type Profile, type RegisterRow,
} from '@/lib/types';

const ALL = '__all__';

const STATUS_OPTIONS = [
  { value: 'expired', label: 'Expired' },
  { value: 'expiring_soon', label: 'Expiring within 30 days' },
  { value: 'valid', label: 'Valid' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'renewed', label: 'Renewed (history)' },
  { value: 'archived', label: 'Archived' },
];

interface Props {
  rows: RegisterRow[];
  entities: Entity[];
  documentTypes: DocumentType[];
  team: Profile[];
  canWrite: boolean;
  initialFilters: RegisterFilters;
}

export function DocumentsClient({
  rows, entities, documentTypes, team, canWrite, initialFilters,
}: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<RegisterFilters>(initialFilters);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'expiry_date', dir: 'asc',
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const filtered = applyFilters(rows, filters);
    return sortRows(filtered, sort.key, sort.dir);
  }, [rows, filters, sort]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  function setFilter(key: keyof RegisterFilters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value === ALL ? undefined : value }));
    setSelected(new Set());
  }

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === visible.length ? new Set() : new Set(visible.map((r) => r.id)),
    );
  }

  function exportCsv() {
    // Exports what is on screen, not the whole register - the filters the
    // user just set are almost always the point of the export.
    const blob = new Blob([toCsv(visible)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sanad-register-${dubaiToday()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${visible.length} ${visible.length === 1 ? 'row' : 'rows'}.`);
  }

  function bulkReassign(userId: string) {
    const ids = [...selected];
    startTransition(async () => {
      const result = await reassignDocuments(ids, userId);
      if (!result.ok) { toast.error(result.error ?? 'Could not reassign.'); return; }
      toast.success(`Reassigned ${ids.length} ${ids.length === 1 ? 'document' : 'documents'}.`);
      setSelected(new Set());
      router.refresh();
    });
  }

  function bulkArchive() {
    const ids = [...selected];
    startTransition(async () => {
      const result = await archiveDocuments(ids);
      if (!result.ok) { toast.error(result.error ?? 'Could not archive.'); return; }
      toast.success(`Archived ${ids.length} ${ids.length === 1 ? 'document' : 'documents'}.`);
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Document register</h1>
          <p className="text-sm text-muted-foreground">
            {visible.length} of {rows.length} {rows.length === 1 ? 'document' : 'documents'}
            {activeFilterCount > 0 && ' matching your filters'}.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!visible.length}>
          <Download />Export CSV
        </Button>
      </div>

      {/* Filter bar. Six controls on one line - this user filters constantly. */}
      <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1 lg:col-span-2">
          <Label htmlFor="search">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="search"
              className="pl-8"
              placeholder="Name, number, notes"
              value={filters.search ?? ''}
              onChange={(e) => setFilter('search', e.target.value)}
            />
          </div>
        </div>

        {entities.length > 1 && (
          <FilterSelect
            label="Entity" value={filters.entityId} onChange={(v) => setFilter('entityId', v)}
            options={entities.map((e) => ({ value: e.id, label: e.name }))}
          />
        )}

        <FilterSelect
          label="Holder type" value={filters.holderType} onChange={(v) => setFilter('holderType', v)}
          options={HOLDER_TYPES.map((t) => ({ value: t, label: HOLDER_TYPE_LABELS[t] }))}
        />

        <FilterSelect
          label="Document type" value={filters.documentTypeId} onChange={(v) => setFilter('documentTypeId', v)}
          options={documentTypes.map((t) => ({ value: t.id, label: t.label }))}
        />

        <FilterSelect
          label="Status" value={filters.status} onChange={(v) => setFilter('status', v)}
          options={STATUS_OPTIONS}
        />

        <FilterSelect
          label="Responsible" value={filters.responsibleUserId} onChange={(v) => setFilter('responsibleUserId', v)}
          options={team.map((p) => ({ value: p.id, label: p.full_name || p.email }))}
        />
      </div>

      {activeFilterCount > 0 && (
        <Button
          variant="ghost" size="sm"
          onClick={() => { setFilters({}); setSelected(new Set()); }}
        >
          <X />Clear {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'}
        </Button>
      )}

      {canWrite && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-secondary px-3 py-2">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={pending}>
                <Users />Reassign to
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Responsible person</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {team.map((person) => (
                <DropdownMenuItem key={person.id} onClick={() => bulkReassign(person.id)}>
                  {person.full_name || person.email}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={bulkArchive} disabled={pending}>
            <Archive />Archive
          </Button>

          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <RegisterTable
        rows={visible}
        showEntity={entities.length > 1}
        canWrite={canWrite}
        selectable={canWrite}
        selected={selected}
        onToggle={toggleRow}
        onToggleAll={toggleAll}
        sort={sort}
        onSort={toggleSort}
        emptyMessage={
          rows.length === 0
            ? 'No documents yet.'
            : 'No documents match these filters.'
        }
      />
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value ?? ALL} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
