import { daysUntil, urgencyFor, type Urgency } from '@/lib/dates';
import type { RegisterRow } from '@/lib/types';

/**
 * Dashboard counters, computed here rather than in SQL so they are unit
 * testable against seeded edge cases (expiring today, tomorrow, last week)
 * without needing a database.
 *
 * The buckets are deliberately NESTED, not disjoint: `dueIn30` includes
 * everything in `dueIn7`. An HR manager reading "7 days: 2, 30 days: 5"
 * expects five things to deal with this month, of which two are urgent -
 * not seven. The dashboard says so in the tile caption.
 *
 * Renewed and archived documents count towards nothing. They are history.
 */
export interface RegisterSummary {
  expired: number;
  dueIn7: number;
  dueIn30: number;
  valid: number;
  total: number;
}

const isLive = (row: Pick<RegisterRow, 'status'>) =>
  row.status !== 'renewed' && row.status !== 'archived';

export function summarise(rows: RegisterRow[], now: Date = new Date()): RegisterSummary {
  const summary: RegisterSummary = { expired: 0, dueIn7: 0, dueIn30: 0, valid: 0, total: 0 };

  for (const row of rows) {
    if (!isLive(row)) continue;
    summary.total += 1;

    const days = daysUntil(row.expiry_date, now);
    if (days < 0) {
      summary.expired += 1;
    } else if (days <= 7) {
      summary.dueIn7 += 1;
      summary.dueIn30 += 1;
    } else if (days <= 30) {
      summary.dueIn30 += 1;
    } else {
      summary.valid += 1;
    }
  }

  return summary;
}

/**
 * The dashboard table: everything already expired plus everything expiring
 * in the next `horizon` days, soonest first.
 *
 * Expired documents are included and sort to the top. Dropping them once
 * they lapse would hide exactly the rows costing the customer money.
 */
export function dashboardRows(
  rows: RegisterRow[],
  horizon = 90,
  now: Date = new Date(),
): RegisterRow[] {
  return rows
    .filter((row) => isLive(row) && daysUntil(row.expiry_date, now) <= horizon)
    .sort(byExpiryThenName);
}

export function byExpiryThenName(a: RegisterRow, b: RegisterRow): number {
  if (a.expiry_date !== b.expiry_date) return a.expiry_date < b.expiry_date ? -1 : 1;
  return (a.holder_name ?? a.entity_name).localeCompare(b.holder_name ?? b.entity_name);
}

export function rowUrgency(row: RegisterRow, now: Date = new Date()): Urgency {
  return urgencyFor(daysUntil(row.expiry_date, now));
}

/** Tailwind classes for a register row. Neutral beyond 30 days, by design. */
export function rowClasses(urgency: Urgency): string {
  switch (urgency) {
    case 'expired':
      return 'bg-danger-soft/70 hover:bg-danger-soft';
    case 'critical':
      return 'bg-danger-soft/40 hover:bg-danger-soft/60';
    case 'soon':
      return 'bg-warn-soft/50 hover:bg-warn-soft/70';
    default:
      return 'hover:bg-muted/50';
  }
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  expired: 'Expired',
  critical: 'Critical',
  soon: 'Due soon',
  ok: 'Valid',
};

// ---------------------------------------------------------------------
// Filtering and search for /documents
// ---------------------------------------------------------------------

export interface RegisterFilters {
  entityId?: string;
  holderType?: string;
  documentTypeId?: string;
  status?: string;
  responsibleUserId?: string;
  search?: string;
}

export function applyFilters(
  rows: RegisterRow[],
  filters: RegisterFilters,
  now: Date = new Date(),
): RegisterRow[] {
  const needle = filters.search?.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.entityId && row.entity_id !== filters.entityId) return false;
    if (filters.holderType && row.holder_type !== filters.holderType) return false;
    if (filters.documentTypeId && row.document_type_id !== filters.documentTypeId) return false;
    if (filters.responsibleUserId && row.responsible_user_id !== filters.responsibleUserId) return false;

    if (filters.status) {
      const days = daysUntil(row.expiry_date, now);
      const live = isLive(row);
      switch (filters.status) {
        case 'expired': if (!live || days >= 0) return false; break;
        case 'expiring_soon': if (!live || days < 0 || days > 30) return false; break;
        case 'valid': if (!live || days <= 30) return false; break;
        case 'renewed': if (row.status !== 'renewed') return false; break;
        case 'archived': if (row.status !== 'archived') return false; break;
        case 'needs_review': if (!row.needs_review) return false; break;
      }
    }

    if (needle) {
      const haystack = [
        row.holder_name, row.holder_identifier, row.document_type_label,
        row.document_number, row.entity_name, row.responsible_name, row.notes,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });
}

export type SortKey = 'expiry_date' | 'holder_name' | 'document_type_label' | 'entity_name' | 'responsible_name';

export function sortRows(rows: RegisterRow[], key: SortKey, dir: 'asc' | 'desc'): RegisterRow[] {
  const factor = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = (a[key] ?? '') as string;
    const bv = (b[key] ?? '') as string;
    if (av === bv) return byExpiryThenName(a, b);
    return av < bv ? -factor : factor;
  });
}

// ---------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------

const CSV_COLUMNS: Array<[string, (row: RegisterRow, now: Date) => string]> = [
  ['Entity', (r) => r.entity_name],
  ['Holder', (r) => r.holder_name ?? ''],
  ['Holder type', (r) => r.holder_type ?? ''],
  ['Identifier', (r) => r.holder_identifier ?? ''],
  ['Document type', (r) => r.document_type_label],
  ['Document number', (r) => r.document_number ?? ''],
  ['Issue date', (r) => r.issue_date ?? ''],
  ['Expiry date', (r) => r.expiry_date],
  ['Days remaining', (r, now) => String(daysUntil(r.expiry_date, now))],
  ['Status', (r, now) => (isLive(r) ? URGENCY_LABEL[rowUrgency(r, now)] : r.status)],
  ['Responsible', (r) => r.responsible_name ?? ''],
  ['Notes', (r) => r.notes ?? ''],
];

/**
 * Excel on a Windows laptop is the destination for most of these exports.
 * A leading `=`, `+`, `-` or `@` in a cell makes Excel treat it as a
 * formula, so those are prefixed with a quote - CSV injection is a real
 * risk when the values came from an uploaded document.
 */
function csvCell(value: string): string {
  let out = value ?? '';
  if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  if (/[",\n\r]/.test(out)) out = `"${out.replace(/"/g, '""')}"`;
  return out;
}

export function toCsv(rows: RegisterRow[], now: Date = new Date()): string {
  const header = CSV_COLUMNS.map(([name]) => csvCell(name)).join(',');
  const body = rows.map((row) =>
    CSV_COLUMNS.map(([, get]) => csvCell(get(row, now))).join(','),
  );
  // BOM so Excel opens UTF-8 (Arabic holder names) without mangling it.
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}
