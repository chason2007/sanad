import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

/**
 * Every date in Sanad is a Dubai date.
 *
 * The server runs in UTC on Vercel and the user's browser runs in whatever
 * timezone their laptop is set to. Neither is the right answer: a trade
 * licence expires on a calendar day in the UAE. So nothing in this app ever
 * calls `new Date()` and reads a day off it - it goes through here.
 *
 * Expiry, issue and renewal dates are Postgres `date` columns and travel as
 * plain 'yyyy-MM-dd' strings. They are calendar facts, not instants, and are
 * deliberately never converted to a timezone - converting them is what
 * produces the classic off-by-one where a document expires "yesterday".
 */
export const DUBAI_TZ = 'Asia/Dubai';

export type IsoDate = string; // 'yyyy-MM-dd'

/** Today's calendar date in Dubai. The only "today" this app recognises. */
export function dubaiToday(now: Date = new Date()): IsoDate {
  return format(new TZDate(now, DUBAI_TZ), 'yyyy-MM-dd');
}

/** Current wall-clock hour in Dubai (0-23). Used to gate the daily job. */
export function dubaiHour(now: Date = new Date()): number {
  return Number(format(new TZDate(now, DUBAI_TZ), 'H'));
}

function toUtcMillis(ymd: IsoDate): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole calendar days from Dubai-today until `expiry`. Negative = past. */
export function daysUntil(expiry: IsoDate, now: Date = new Date()): number {
  return Math.round((toUtcMillis(expiry) - toUtcMillis(dubaiToday(now))) / 86_400_000);
}

/** Shift a calendar date by whole days, staying in calendar space. */
export function addDays(ymd: IsoDate, days: number): IsoDate {
  const d = new Date(toUtcMillis(ymd) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  // Rejects 2026-02-30 and friends, which Date would silently roll over.
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Turn a calendar date into a Date positioned at LOCAL midnight.
 *
 * Deliberately not UTC midnight: date-fns `format` renders in the process
 * timezone, so a UTC-midnight instant formats as the previous day anywhere
 * west of Greenwich - an expiry date silently shown one day early. Local
 * midnight always formats back as the same calendar day, in every zone.
 */
function calendarDate(ymd: IsoDate): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const out = new Date(y, m - 1, d, 12, 0, 0, 0); // noon: immune to DST shifts
  return out;
}

/** '09 Sep 2026' - unambiguous for a UAE audience, no MM/DD confusion. */
export function formatDate(ymd: IsoDate | null | undefined): string {
  if (!ymd || !isValidIsoDate(ymd)) return '--';
  return format(calendarDate(ymd), 'dd MMM yyyy');
}

/** A timestamptz rendered in Dubai time, e.g. '09 Sep 2026, 14:30'. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '--';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '--';
  return format(new TZDate(parsed, DUBAI_TZ), 'dd MMM yyyy, HH:mm');
}

/** "in 12 days" / "today" / "8 days ago" - the phrasing on the dashboard. */
export function describeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export type Urgency = 'expired' | 'critical' | 'soon' | 'ok';

/**
 * The urgency bands the whole UI colours from. Boundaries are inclusive on
 * the near side: a document expiring exactly today is critical, not expired.
 */
export function urgencyFor(days: number): Urgency {
  if (days < 0) return 'expired';
  if (days <= 7) return 'critical';
  if (days <= 30) return 'soon';
  return 'ok';
}

export const MONTH_LABEL = (ymd: IsoDate) => format(calendarDate(ymd), 'MMMM yyyy');
