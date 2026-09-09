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
