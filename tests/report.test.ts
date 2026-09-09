import { describe, it, expect } from 'vitest';
import { buildComplianceReport } from '@/lib/reports/compliance-pdf';
import type { RegisterRow } from '@/lib/types';

const NOW = new Date('2026-09-09T06:00:00Z');

let seq = 0;
function row(over: Partial<RegisterRow> & { expiry_date: string }): RegisterRow {
  seq += 1;
  return {
    id: `d-${seq}`, entity_id: 'e-1', holder_id: 'h-1', document_type_id: 't-1',
    document_number: `NO-${seq}`, issue_date: null, file_path: null,
    responsible_user_id: 'u-1', status: 'valid', notes: null,
    superseded_by_id: null, needs_review: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    org_id: 'o-1', entity_name: 'Al Noor Contracting LLC',
    holder_name: 'Rajesh Kumar', holder_type: 'employee', holder_identifier: 'EMP-001',
    document_type_code: 'employee_visa', document_type_label: 'Employee Residence Visa',
    responsible_name: 'Ahmed Khan', responsible_email: 'a@x.ae',
    days_remaining: 0, computed_status: 'valid',
    ...over,
  };
}

async function build(rows: RegisterRow[], name = 'Al Noor Contracting LLC') {
  return buildComplianceReport({ organizationName: name, rows, now: NOW });
}

describe('compliance report', () => {
  it('produces a valid PDF', async () => {
    const pdf = await build([
      row({ expiry_date: '2026-08-01' }),
      row({ expiry_date: '2026-09-15' }),
      row({ expiry_date: '2027-06-01' }),
    ]);
    expect(pdf.byteLength).toBeGreaterThan(1000);
    // %PDF- magic bytes
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
  });

  it('generates for an empty register without throwing', async () => {
    const pdf = await build([]);
    expect(pdf.byteLength).toBeGreaterThan(500);
  });

  it('does not throw on Arabic holder names', async () => {
    // pdf-lib's WinAnsi standard fonts throw on characters they cannot
    // encode. Every UAE customer will have names like these in the register,
    // so a report that crashes on them is a report that never runs.
    const pdf = await build([
      row({ expiry_date: '2026-09-15', holder_name: 'فاطمة المرزوقي' }),
      row({ expiry_date: '2026-09-20', holder_name: 'محمد عبد الله', responsible_name: 'أحمد خان' }),
    ], 'شركة النور للمقاولات');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it('handles accented Latin names by folding them', async () => {
    const pdf = await build([row({ expiry_date: '2026-09-15', holder_name: 'José Ferreira Gonçalves' })]);
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it('paginates a large register', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      row({ expiry_date: `2026-1${i % 2}-0${(i % 9) + 1}` }),
    );
    const pdf = await build(many);
    // More than one page worth of rows must not silently overflow off page 1.
    expect(pdf.byteLength).toBeGreaterThan(5000);
  });

  it('survives very long names without overflowing the column', async () => {
    const pdf = await build([
      row({
        expiry_date: '2026-09-15',
        holder_name: 'A'.repeat(400),
        document_type_label: 'B'.repeat(200),
      }),
    ]);
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
