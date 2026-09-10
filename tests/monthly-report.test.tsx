import { describe, it, expect } from 'vitest';
import { renderEntityReport, computeStats } from '@/lib/reports/monthly-report';
import type { RegisterRow } from '@/lib/types';

const NOW = new Date('2026-09-10T06:00:00Z');

let seq = 0;
function row(over: Partial<RegisterRow> & { expiry_date: string }): RegisterRow {
  seq += 1;
  return {
    id: `d-${seq}`, entity_id: 'e-1', holder_id: 'h-1', document_type_id: 't-1',
    document_number: `NO-${seq}`, issue_date: null, file_path: null,
    responsible_user_id: 'u-1', status: 'valid', notes: null,
    superseded_by_id: null, needs_review: false,
    created_at: '', updated_at: '',
    org_id: 'o-1', entity_name: 'Al Noor Contracting LLC',
    holder_name: 'Rajesh Kumar', holder_type: 'employee', holder_identifier: 'EMP-002',
    document_type_code: 'employee_visa', document_type_label: 'Employee Residence Visa',
    responsible_name: 'Fatima', responsible_email: 'f@x.ae',
    days_remaining: 0, computed_status: 'valid',
    ...over,
  };
}

const render = (rows: RegisterRow[], entityName = 'Al Noor Contracting LLC') =>
  renderEntityReport({ organizationName: 'Al Noor Group', entityName, rows, now: NOW });

/** Counts "/Type /Page" occurrences, which is one per page in the PDF. */
function pageCount(pdf: Buffer): number {
  const matches = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

describe('compliance percentage', () => {
  it('is the share of live documents that have not lapsed', () => {
    const rows = [
      row({ expiry_date: '2026-09-01' }), // expired
      row({ expiry_date: '2026-09-20' }), // due soon
      row({ expiry_date: '2027-06-01' }), // valid
      row({ expiry_date: '2027-06-01' }), // valid
    ];
    expect(computeStats(rows, NOW)).toMatchObject({
      total: 4, expired: 1, dueIn60: 1, valid: 2, compliancePercent: 75,
    });
  });

  it('counts a document due soon as still compliant', () => {
    // Otherwise 100% is unreachable and the number becomes ignorable.
    expect(computeStats([row({ expiry_date: '2026-09-20' })], NOW).compliancePercent).toBe(100);
  });

  it('treats a document expiring today as compliant, not lapsed', () => {
    expect(computeStats([row({ expiry_date: '2026-09-10' })], NOW).compliancePercent).toBe(100);
    expect(computeStats([row({ expiry_date: '2026-09-09' })], NOW).compliancePercent).toBe(0);
  });

  it('is 100% for an empty register rather than NaN', () => {
    expect(computeStats([], NOW).compliancePercent).toBe(100);
  });

  it('ignores renewed and archived documents', () => {
    const rows = [
      row({ expiry_date: '2026-09-01', status: 'renewed' }),
      row({ expiry_date: '2026-09-01', status: 'archived' }),
      row({ expiry_date: '2027-01-01' }),
    ];
    expect(computeStats(rows, NOW)).toMatchObject({ total: 1, expired: 0, compliancePercent: 100 });
  });
});

describe('the report is one page', () => {
  it('renders a valid PDF', async () => {
    const pdf = await render([row({ expiry_date: '2026-09-20' })]);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
  });

  it('stays one page with an empty register', async () => {
    expect(pageCount(await render([]))).toBe(1);
  });

  it('stays one page with 400 documents', async () => {
    // Management will not read two pages. This is the test that keeps that
    // promise honest as customers grow.
    const many = Array.from({ length: 400 }, (_, i) =>
      row({ expiry_date: i % 2 ? '2026-09-01' : '2026-10-15' }),
    );
    const pdf = await render(many);
    expect(pageCount(pdf)).toBe(1);
  }, 30000);

  it('stays one page when everything has lapsed', async () => {
    const many = Array.from({ length: 200 }, () => row({ expiry_date: '2026-01-01' }));
    expect(pageCount(await render(many))).toBe(1);
  }, 30000);

  it('stays one page with very long names', async () => {
    const many = Array.from({ length: 60 }, () =>
      row({
        expiry_date: '2026-10-01',
        holder_name: 'Mohammed Abdul Rahman Al Shamsi Al Maktoum Al Falasi'.repeat(2),
        document_type_label: 'Employee Residence Visa (Skilled Category, Renewal)'.repeat(2),
      }),
    );
    expect(pageCount(await render(many))).toBe(1);
  }, 30000);
});

describe('content', () => {
  it('does not throw on Arabic names', async () => {
    const pdf = await render(
      [row({ expiry_date: '2026-09-20', holder_name: 'فاطمة المرزوقي', responsible_name: 'أحمد' })],
      'شركة النور',
    );
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(pageCount(pdf)).toBe(1);
  });

  it('renders for an entity with only expired documents', async () => {
    const pdf = await render([row({ expiry_date: '2026-08-01' })]);
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
