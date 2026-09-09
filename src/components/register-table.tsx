'use client';

import Link from 'next/link';
import { ArrowUpDown, FileWarning, Paperclip } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { RenewDialog } from '@/components/renew-dialog';
import { daysUntil, describeDays, formatDate, urgencyFor } from '@/lib/dates';
import { rowClasses, URGENCY_LABEL, type SortKey } from '@/lib/register';
import { HOLDER_TYPE_LABELS, type RegisterRow } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  rows: RegisterRow[];
  showEntity?: boolean;
  canWrite?: boolean;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
  sort?: { key: SortKey; dir: 'asc' | 'desc' };
  onSort?: (key: SortKey) => void;
  emptyMessage?: string;
}

/**
 * The register.
 *
 * Deliberately built like a spreadsheet: one line per row, tabular numerals,
 * no card padding, no chart. The customer is migrating off Excel and reads
 * forty rows at a glance - density is the feature.
 */
export function RegisterTable({
  rows, showEntity = false, canWrite = true, selectable = false,
  selected, onToggle, onToggleAll, sort, onSort,
  emptyMessage = 'Nothing here yet.',
}: Props) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed py-14 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  const allSelected = selectable && selected != null && rows.every((r) => selected.has(r.id));

  const SortableHead = ({ label, sortKey, className }: { label: string; sortKey: SortKey; className?: string }) => (
    <th className={cn('px-2 py-2 text-left font-medium', className)}>
      {onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          {label}
          <ArrowUpDown className={cn('h-3 w-3', sort?.key === sortKey ? 'opacity-100' : 'opacity-30')} />
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead className="border-b bg-muted/50 text-2xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {selectable && (
              <th className="w-9 px-2 py-2">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={onToggleAll}
                  aria-label="Select all rows"
                />
              </th>
            )}
            <SortableHead label="Holder" sortKey="holder_name" />
            <SortableHead label="Document" sortKey="document_type_label" />
            {showEntity && <SortableHead label="Entity" sortKey="entity_name" />}
            <SortableHead label="Expires" sortKey="expiry_date" className="w-28" />
            <th className="w-32 px-2 py-2 text-left font-medium">Days left</th>
            <SortableHead label="Responsible" sortKey="responsible_name" className="w-40" />
            {canWrite && <th className="w-32 px-2 py-2 text-right font-medium">Action</th>}
          </tr>
        </thead>

        <tbody className="divide-y">
          {rows.map((row) => {
            const days = daysUntil(row.expiry_date);
            const urgency = urgencyFor(days);
            const isHistory = row.status === 'renewed' || row.status === 'archived';

            return (
              <tr
                key={row.id}
                className={cn(
                  'transition-colors',
                  isHistory ? 'text-muted-foreground hover:bg-muted/50' : rowClasses(urgency),
                )}
              >
                {selectable && (
                  <td className="px-2 py-1.5">
                    <Checkbox
                      checked={selected?.has(row.id) ?? false}
                      onCheckedChange={() => onToggle?.(row.id)}
                      aria-label={`Select ${row.document_type_label}`}
                    />
                  </td>
                )}

                <td className="px-2 py-1.5">
                  <Link href={`/documents/${row.id}`} className="font-medium hover:underline">
                    {row.holder_name ?? row.entity_name}
                  </Link>
                  <span className="block text-2xs text-muted-foreground">
                    {row.holder_type ? HOLDER_TYPE_LABELS[row.holder_type] : 'Company'}
                    {row.holder_identifier ? ` · ${row.holder_identifier}` : ''}
                  </span>
                </td>

                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-1.5">
                    {row.document_type_label}
                    {row.needs_review && (
                      <FileWarning className="h-3.5 w-3.5 text-warn" aria-label="Needs review" />
                    )}
                    {row.file_path && (
                      <Paperclip className="h-3 w-3 text-muted-foreground" aria-label="Has a file" />
                    )}
                  </span>
                  {row.document_number && (
                    <span className="block font-mono text-2xs text-muted-foreground">
                      {row.document_number}
                    </span>
                  )}
                </td>

                {showEntity && <td className="px-2 py-1.5">{row.entity_name}</td>}

                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                  {formatDate(row.expiry_date)}
                </td>

                <td className="px-2 py-1.5">
                  {isHistory ? (
                    <Badge variant="default">{row.status === 'renewed' ? 'Renewed' : 'Archived'}</Badge>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Badge variant={urgency}>{URGENCY_LABEL[urgency]}</Badge>
                      <span className="text-2xs text-muted-foreground">{describeDays(days)}</span>
                    </span>
                  )}
                </td>

                <td className="truncate px-2 py-1.5">
                  {row.responsible_name || <span className="text-muted-foreground">Unassigned</span>}
                </td>

                {canWrite && (
                  <td className="px-2 py-1.5 text-right">
                    {!isHistory && (
                      <RenewDialog
                        documentId={row.id}
                        documentLabel={row.document_type_label}
                        holderName={row.holder_name}
                        currentExpiry={row.expiry_date}
                      />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
