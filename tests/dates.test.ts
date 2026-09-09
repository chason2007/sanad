import { describe, it, expect, afterEach } from 'vitest';
import {
  dubaiToday, daysUntil, addDays, formatDate, formatDateTime,
  urgencyFor, describeDays, isValidIsoDate,
} from '@/lib/dates';

/**
 * Phase 1 criterion: "All dates render in Asia/Dubai regardless of browser
 * timezone." Every assertion below is repeated with the process timezone set
 * to zones on either side of Dubai, including ones that are a full calendar
 * day apart from it.
 */
const ZONES = ['UTC', 'Asia/Dubai', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Midway'];

const originalTz = process.env.TZ;
afterEach(() => { process.env.TZ = originalTz; });

function inZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  return fn();
}

describe('dubaiToday', () => {
  it.each(ZONES)('resolves the Dubai calendar day when the process runs in %s', (tz) => {
    inZone(tz, () => {
      // 21:00 UTC is already tomorrow in Dubai (+04).
      expect(dubaiToday(new Date('2026-09-08T21:00:00Z'))).toBe('2026-09-09');
      // 19:00 UTC is still the same Dubai day, at 23:00.
      expect(dubaiToday(new Date('2026-09-09T19:00:00Z'))).toBe('2026-09-09');
      // 20:30 UTC crosses Dubai midnight.
      expect(dubaiToday(new Date('2026-09-09T20:30:00Z'))).toBe('2026-09-10');
      // Just after Dubai midnight.
      expect(dubaiToday(new Date('2026-09-09T20:00:00Z'))).toBe('2026-09-10');
    });
  });
});

describe('daysUntil - the arithmetic every alert depends on', () => {
  const now = new Date('2026-09-09T06:00:00Z'); // 10:00 in Dubai

  it.each(ZONES)('is stable in %s', (tz) => {
    inZone(tz, () => {
      expect(daysUntil('2026-09-09', now)).toBe(0);   // expires today
      expect(daysUntil('2026-09-10', now)).toBe(1);   // expires tomorrow
      expect(daysUntil('2026-09-02', now)).toBe(-7);  // expired last week
      expect(daysUntil('2026-12-08', now)).toBe(90);
      expect(daysUntil('2026-10-09', now)).toBe(30);
    });
  });

  it('does not drift across a Dubai midnight boundary', () => {
    // 20:00 UTC == 00:00 Dubai on the 10th, so a doc expiring on the 10th
    // is due "today", not "tomorrow". Getting this wrong sends the 1-day
    // warning a day late, which is the whole product failing.
    expect(daysUntil('2026-09-10', new Date('2026-09-09T19:59:00Z'))).toBe(1);
    expect(daysUntil('2026-09-10', new Date('2026-09-09T20:01:00Z'))).toBe(0);
  });

  it('handles month and year boundaries', () => {
    expect(daysUntil('2027-01-01', new Date('2026-12-31T10:00:00Z'))).toBe(1);
    expect(daysUntil('2026-03-01', new Date('2026-02-28T10:00:00Z'))).toBe(1); // 2026 not a leap year
    expect(daysUntil('2028-02-29', new Date('2028-02-28T10:00:00Z'))).toBe(1); // 2028 is
  });
});

describe('addDays', () => {
  it('stays in calendar space across boundaries', () => {
    expect(addDays('2026-09-09', 30)).toBe('2026-10-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('formatting', () => {
  it.each(ZONES)('renders a plain expiry date identically in %s', (tz) => {
    inZone(tz, () => {
      // A `date` column is a calendar fact. It must never shift by a zone.
      expect(formatDate('2026-09-09')).toBe('09 Sep 2026');
      expect(formatDate('2026-01-01')).toBe('01 Jan 2026');
      expect(formatDate('2026-12-31')).toBe('31 Dec 2026');
    });
  });

  it.each(ZONES)('renders a timestamp in Dubai wall-clock time from %s', (tz) => {
    inZone(tz, () => {
      expect(formatDateTime('2026-09-09T06:00:00Z')).toBe('09 Sep 2026, 10:00');
      expect(formatDateTime('2026-09-09T20:30:00Z')).toBe('10 Sep 2026, 00:30');
    });
  });

  it('degrades safely on bad input', () => {
    expect(formatDate(null)).toBe('--');
    expect(formatDate('not-a-date')).toBe('--');
    expect(formatDateTime('nonsense')).toBe('--');
  });
});

describe('isValidIsoDate', () => {
  it('rejects dates that Date would silently roll over', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-09-31')).toBe(false);
    expect(isValidIsoDate('09-09-2026')).toBe(false);
    expect(isValidIsoDate('2026-09-09')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
  });
});

describe('urgency bands', () => {
  it('places the boundaries where the UI claims they are', () => {
    expect(urgencyFor(-1)).toBe('expired');
    expect(urgencyFor(0)).toBe('critical');   // due today is not yet expired
    expect(urgencyFor(7)).toBe('critical');
    expect(urgencyFor(8)).toBe('soon');
    expect(urgencyFor(30)).toBe('soon');
    expect(urgencyFor(31)).toBe('ok');
  });
});

describe('describeDays', () => {
  it('reads like a person wrote it', () => {
    expect(describeDays(0)).toBe('today');
    expect(describeDays(1)).toBe('tomorrow');
    expect(describeDays(-1)).toBe('yesterday');
    expect(describeDays(12)).toBe('in 12 days');
    expect(describeDays(-8)).toBe('8 days ago');
  });
});
