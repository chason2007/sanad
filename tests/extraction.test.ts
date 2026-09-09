import { describe, it, expect } from 'vitest';
import { sanityCheck } from '@/lib/extraction/extract';
import { buildSystemPrompt } from '@/lib/extraction/prompt';
import { REVIEW_THRESHOLD, type ExtractionPayload } from '@/lib/extraction/schema';

const NOW = new Date('2026-09-09T06:00:00Z');
const CODES = new Set(['employee_visa', 'trade_licence', 'emirates_id']);

function payload(over: Partial<ExtractionPayload> = {}): ExtractionPayload {
  return {
    document_type_code: 'employee_visa',
    document_number: '784-1990-1234567-1',
    holder_name: 'Fatima Al Marzooqi',
    issue_date: '2024-09-10',
    expiry_date: '2026-09-10',
    confidence: 0.95,
    reasoning: 'Read the field labelled Expiry Date.',
    ...over,
  };
}

const review = (c: number) => c < REVIEW_THRESHOLD;

describe('sanityCheck', () => {
  it('leaves a clean, well-formed extraction alone', () => {
    const { confidence, warnings } = sanityCheck(payload(), CODES, NOW);
    expect(confidence).toBe(0.95);
    expect(warnings).toEqual([]);
    expect(review(confidence)).toBe(false);
  });

  it('catches the swapped issue/expiry pair even at high self-reported confidence', () => {
    // The failure the prompt warns about, arriving with a confident 0.97.
    // Self-reported confidence is a signal, not evidence.
    const { confidence, warnings } = sanityCheck(
      payload({ issue_date: '2026-09-10', expiry_date: '2024-09-10', confidence: 0.97 }),
      CODES, NOW,
    );
    expect(confidence).toBeLessThanOrEqual(0.3);
    expect(review(confidence)).toBe(true);
    expect(warnings.join(' ')).toMatch(/swapped/i);
  });

  it('catches identical issue and expiry dates', () => {
    const { confidence } = sanityCheck(
      payload({ issue_date: '2026-09-10', expiry_date: '2026-09-10' }), CODES, NOW,
    );
    expect(review(confidence)).toBe(true);
  });

  it('zeroes confidence when no expiry date was found', () => {
    const { confidence, warnings } = sanityCheck(payload({ expiry_date: null }), CODES, NOW);
    expect(confidence).toBe(0);
    expect(warnings[0]).toMatch(/no expiry date/i);
  });

  it('rejects a malformed or hallucinated date', () => {
    expect(sanityCheck(payload({ expiry_date: '2026-13-45' }), CODES, NOW).confidence).toBe(0);
    expect(sanityCheck(payload({ expiry_date: '10 Sep 2026' }), CODES, NOW).confidence).toBe(0);
    expect(sanityCheck(payload({ expiry_date: '2026-02-30' }), CODES, NOW).confidence).toBe(0);
  });

  it('flags an unrecognised document type code', () => {
    const { confidence, warnings } = sanityCheck(
      payload({ document_type_code: 'golden_visa_platinum' }), CODES, NOW,
    );
    expect(review(confidence)).toBe(true);
    expect(warnings.join(' ')).toMatch(/unrecognised/i);
  });

  it('sends an explicit "unknown" classification to review', () => {
    const { confidence } = sanityCheck(payload({ document_type_code: 'unknown' }), CODES, NOW);
    expect(review(confidence)).toBe(true);
  });

  it('flags implausible far-future and long-past expiry dates', () => {
    expect(review(sanityCheck(payload({ expiry_date: '2126-09-10' }), CODES, NOW).confidence)).toBe(true);
    expect(review(sanityCheck(payload({ expiry_date: '2005-09-10' }), CODES, NOW).confidence)).toBe(true);
  });

  it('accepts a recently expired document without complaint', () => {
    // Expired documents are the whole reason the customer bought this.
    const { confidence, warnings } = sanityCheck(
      payload({ issue_date: '2023-09-10', expiry_date: '2026-08-01' }), CODES, NOW,
    );
    expect(confidence).toBe(0.95);
    expect(warnings).toEqual([]);
  });

  it('never raises the model self-reported confidence', () => {
    const { confidence } = sanityCheck(payload({ confidence: 0.42 }), CODES, NOW);
    expect(confidence).toBe(0.42);
    expect(review(confidence)).toBe(true);
  });

  it('clamps nonsense confidence values into range', () => {
    expect(sanityCheck(payload({ confidence: 5 }), CODES, NOW).confidence).toBe(1);
    expect(sanityCheck(payload({ confidence: -2 }), CODES, NOW).confidence).toBe(0);
    expect(sanityCheck(payload({ confidence: NaN }), CODES, NOW).confidence).toBe(0);
  });

  it('handles a missing issue date without penalising the read', () => {
    const { confidence, warnings } = sanityCheck(payload({ issue_date: null }), CODES, NOW);
    expect(confidence).toBe(0.95);
    expect(warnings).toEqual([]);
  });
});

describe('system prompt', () => {
  const prompt = buildSystemPrompt([
    { code: 'employee_visa', label: 'Employee Residence Visa' },
    { code: 'trade_licence', label: 'Trade Licence' },
  ]);

  it('lists the valid codes so the model classifies into the known set', () => {
    expect(prompt).toContain('employee_visa: Employee Residence Visa');
    expect(prompt).toContain('trade_licence: Trade Licence');
    expect(prompt).toContain('unknown');
  });

  it('tells the model the expiry is the later of the two dates', () => {
    expect(prompt).toMatch(/expiry date is the LATER of the two dates/);
  });

  it('carries the Arabic labels that appear on real UAE documents', () => {
    expect(prompt).toContain('تاريخ الانتهاء');
    expect(prompt).toContain('تاريخ الإصدار');
  });

  it('names the 0.7 threshold for ambiguous date pairs', () => {
    expect(prompt).toMatch(/Below 0\.7 if the issue and expiry dates could plausibly be swapped/);
  });

  it('warns against assuming US month-first date order', () => {
    expect(prompt).toMatch(/day-first/i);
  });
});
