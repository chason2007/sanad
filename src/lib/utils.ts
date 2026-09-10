import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Trim, collapse whitespace, and turn empty strings into null for the DB. */
export function nullifyEmpty(value: FormDataEntryValue | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length ? trimmed : null;
}

export function requiredString(value: FormDataEntryValue | null | undefined, field: string): string {
  const out = nullifyEmpty(value);
  if (!out) throw new Error(`${field} is required.`);
  return out;
}

/**
 * Radix Select cannot use an empty string as an item value, so "no
 * selection" options carry a sentinel instead. Anything reading a select
 * that has one MUST pass the value through here before it reaches the
 * database, or Postgres is handed the literal "__none__" as a uuid.
 */
export const NONE_VALUE = '__none__';

export function nullifySelect(value: FormDataEntryValue | null | undefined): string | null {
  const out = nullifyEmpty(value);
  return out === NONE_VALUE ? null : out;
}
