import { describe, it, expect } from 'vitest';
import { nullifyEmpty, nullifySelect, requiredString, NONE_VALUE } from '@/lib/utils';

describe('nullifySelect', () => {
  /**
   * Regression: the "The company itself" option on the document detail form
   * submitted the sentinel straight through to Postgres as a uuid, so the
   * save failed with a cast error. Radix Select cannot use "" as an item
   * value, so the sentinel has to be unwound at the action boundary.
   */
  it('turns the no-selection sentinel into null', () => {
    expect(nullifySelect(NONE_VALUE)).toBeNull();
    expect(nullifySelect('__none__')).toBeNull();
  });

  it('passes a real id through untouched', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(nullifySelect(id)).toBe(id);
  });

  it('still handles the empty and missing cases', () => {
    expect(nullifySelect('')).toBeNull();
    expect(nullifySelect('   ')).toBeNull();
    expect(nullifySelect(null)).toBeNull();
    expect(nullifySelect(undefined)).toBeNull();
  });
});

describe('nullifyEmpty', () => {
  it('trims and collapses whitespace', () => {
    expect(nullifyEmpty('  Fatima   Al  Marzooqi ')).toBe('Fatima Al Marzooqi');
  });

  it('returns null for blank input', () => {
    expect(nullifyEmpty('')).toBeNull();
    expect(nullifyEmpty('\t\n  ')).toBeNull();
    expect(nullifyEmpty(null)).toBeNull();
  });

  it('does NOT unwrap the sentinel - that is nullifySelect\'s job', () => {
    // Kept deliberately distinct: most fields are free text where the
    // literal string "__none__" would be a legitimate value.
    expect(nullifyEmpty(NONE_VALUE)).toBe(NONE_VALUE);
  });
});

describe('requiredString', () => {
  it('names the field in the error so the message is usable', () => {
    expect(() => requiredString('', 'Expiry date')).toThrow(/Expiry date is required/);
    expect(() => requiredString(null, 'Entity')).toThrow(/Entity is required/);
  });

  it('returns the cleaned value when present', () => {
    expect(requiredString('  Trade Licence  ', 'Document type')).toBe('Trade Licence');
  });
});
