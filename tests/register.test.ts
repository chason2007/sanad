import { describe, it, expect } from 'vitest';
import { summarise, dashboardRows, applyFilters, toCsv } from '@/lib/register';
import type { RegisterRow } from '@/lib/types';

const NOW = new Date('2026-09-09T06:00:00Z'); // 10:00 Dubai, 9 Sep 2026

let seq = 0;
function row(partial: Partial<RegisterRow> & { expiry_date: string }): RegisterRow {
  seq += 1;
  return {
    id: `doc-${seq}`,
    entity_id: 'ent-1',
    holder_id: 'hold-1',
    document_type_id: 'dt-1',
    document_number: `NO-${seq}`,
    issue_date: null,
    file_path: null,
    responsible_user_id: 'user-1',
    status: 'valid',
    notes: null,
    superseded_by_id: null,
    needs_review: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    org_id: 'org-1',
    entity_name: 'Al Noor Contracting LLC',
    holder_name: 'Fatima Al Marzooqi',
    holder_type: 'employee',
    holder_identifier: 'EMP-001',
    document_type_code: 'employee_visa',
    document_type_label: 'Employee Residence Visa',
    responsible_name: 'Ahmed Khan',
    responsible_email: 'ahmed@example.ae',
    days_remaining: 0,
    computed_status: 'valid',
    ...partial,
  };
}

describe('dashboard counters against the seeded edge cases', () => {
  // These three are named explicitly in the Phase 1 acceptance criteria.
  const expiringToday = row({ expiry_date: '2026-09-09' });
  const expiringTomorrow = row({ expiry_date: '2026-09-10' });
  const expiredLastWeek = row({ expiry_date: '2026-09-02' });

  it('classifies each edge case into exactly the right bucket', () => {
    expect(summarise([expiringToday], NOW)).toMatchObject({ expired: 0, dueIn7: 1, dueIn30: 1, valid: 0 });
    expect(summarise([expiringTomorrow], NOW)).toMatchObject({ expired: 0, dueIn7: 1, dueIn30: 1, valid: 0 });
    expect(summarise([expiredLastWeek], NOW)).toMatchObject({ expired: 1, dueIn7: 0, dueIn30: 0, valid: 0 });
  });

  it('counts the three together correctly', () => {
    const summary = summarise([expiringToday, expiringTomorrow, expiredLastWeek], NOW);
    expect(summary).toEqual({ expired: 1, dueIn7: 2, dueIn30: 2, valid: 0, total: 3 });
  });

  it('puts the boundary days on the side the UI promises', () => {
    const rows = [
      row({ expiry_date: '2026-09-08' }), // -1  expired
      row({ expiry_date: '2026-09-09' }), //  0  due in 7
      row({ expiry_date: '2026-09-16' }), //  7  due in 7
      row({ expiry_date: '2026-09-17' }), //  8  due in 30 only
      row({ expiry_date: '2026-10-09' }), // 30  due in 30 only
      row({ expiry_date: '2026-10-10' }), // 31  valid
    ];
    expect(summarise(rows, NOW)).toEqual({ expired: 1, dueIn7: 2, dueIn30: 4, valid: 1, total: 6 });
  });

  it('nests the buckets: every dueIn7 row is also a dueIn30 row', () => {
    const rows = [
      row({ expiry_date: '2026-09-11' }),
      row({ expiry_date: '2026-09-12' }),
      row({ expiry_date: '2026-09-25' }),
    ];
    const s = summarise(rows, NOW);
    expect(s.dueIn7).toBe(2);
    expect(s.dueIn30).toBe(3);
    expect(s.dueIn30).toBeGreaterThanOrEqual(s.dueIn7);
  });

  it('excludes renewed and archived documents from every bucket', () => {
    const rows = [
      row({ expiry_date: '2026-09-02', status: 'renewed' }),
      row({ expiry_date: '2026-09-02', status: 'archived' }),
      row({ expiry_date: '2026-09-02' }),
    ];
    expect(summarise(rows, NOW)).toEqual({ expired: 1, dueIn7: 0, dueIn30: 0, valid: 0, total: 1 });
  });

  it('every live document lands in exactly one of expired/dueIn30/valid', () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      row({ expiry_date: `2026-${String(8 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}` }),
    );
    const s = summarise(rows, NOW);
    expect(s.expired + s.dueIn30 + s.valid).toBe(s.total);
  });
});

describe('dashboardRows', () => {
  it('shows the 90-day horizon plus everything already expired, soonest first', () => {
    const rows = [
      row({ expiry_date: '2026-12-25' }), // 107 days - beyond the horizon
      row({ expiry_date: '2026-10-01' }),
      row({ expiry_date: '2026-08-01' }), // expired, must still appear
      row({ expiry_date: '2026-09-09' }),
    ];
    const visible = dashboardRows(rows, 90, NOW).map((r) => r.expiry_date);
    expect(visible).toEqual(['2026-08-01', '2026-09-09', '2026-10-01']);
  });

  it('hides renewed documents', () => {
    const rows = [row({ expiry_date: '2026-09-15', status: 'renewed' })];
    expect(dashboardRows(rows, 90, NOW)).toHaveLength(0);
  });
});

describe('filters', () => {
  const rows = [
    row({ expiry_date: '2026-09-02', holder_name: 'Fatima Al Marzooqi' }),
    row({ expiry_date: '2026-09-20', holder_name: 'Rajesh Kumar', holder_type: 'employee' }),
    row({ expiry_date: '2027-01-01', holder_name: 'Toyota Hilux', holder_type: 'vehicle', document_type_label: 'Vehicle Registration' }),
  ];

  it('filters by computed status, not the stored column', () => {
    expect(applyFilters(rows, { status: 'expired' }, NOW)).toHaveLength(1);
    expect(applyFilters(rows, { status: 'expiring_soon' }, NOW)).toHaveLength(1);
    expect(applyFilters(rows, { status: 'valid' }, NOW)).toHaveLength(1);
  });

  it('filters by holder type', () => {
    expect(applyFilters(rows, { holderType: 'vehicle' }, NOW)).toHaveLength(1);
  });

  it('searches across holder, document and identifier', () => {
    expect(applyFilters(rows, { search: 'hilux' }, NOW)).toHaveLength(1);
    expect(applyFilters(rows, { search: 'RAJESH' }, NOW)).toHaveLength(1);
    expect(applyFilters(rows, { search: 'nobody' }, NOW)).toHaveLength(0);
  });
});

describe('CSV export', () => {
  it('neutralises formula injection from extracted document text', () => {
    const csv = toCsv([row({ expiry_date: '2026-09-09', holder_name: '=cmd|calc!A1' })], NOW);
    expect(csv).toContain(`'=cmd|calc!A1`);
    expect(csv).not.toMatch(/,=cmd/);
  });

  it('quotes values containing commas and quotes', () => {
    const csv = toCsv([row({ expiry_date: '2026-09-09', notes: 'Renewed, but check "the" file' })], NOW);
    expect(csv).toContain('"Renewed, but check ""the"" file"');
  });

  it('starts with a BOM so Excel reads Arabic names correctly', () => {
    const csv = toCsv([row({ expiry_date: '2026-09-09', holder_name: 'فاطمة المرزوقي' })], NOW);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('فاطمة المرزوقي');
  });
});
