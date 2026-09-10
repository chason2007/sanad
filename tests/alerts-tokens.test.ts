import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAlertToken, verifyAlertToken } from '@/lib/alerts/tokens';

const ALERT = 'aaaaaaaa-0000-4000-8000-000000000001';
const DOC = 'dddddddd-0000-4000-8000-000000000002';
const NOW = new Date('2026-09-10T06:00:00Z');

const original = process.env.CRON_SECRET;
beforeAll(() => { process.env.CRON_SECRET = 'test-secret-do-not-use-in-production'; });
afterAll(() => { process.env.CRON_SECRET = original; });

const make = (over: Partial<Parameters<typeof createAlertToken>[0]> = {}) =>
  createAlertToken({ alertId: ALERT, documentId: DOC, action: 'acknowledge', ...over }, NOW);

describe('alert action tokens', () => {
  it('round-trips a valid token', () => {
    const result = verifyAlertToken(make(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.a).toBe(ALERT);
    expect(result.payload.d).toBe(DOC);
    expect(result.payload.t).toBe('acknowledge');
  });

  it('rejects a tampered payload', () => {
    // Swap the alert id for another and re-encode, keeping the old signature.
    const token = make();
    const [body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    payload.a = 'bbbbbbbb-0000-4000-8000-000000000009';
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
    expect(verifyAlertToken(forged, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = make();
    process.env.CRON_SECRET = 'a-different-secret';
    const result = verifyAlertToken(token, NOW);
    process.env.CRON_SECRET = 'test-secret-do-not-use-in-production';
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects an expired token', () => {
    const token = createAlertToken(
      { alertId: ALERT, documentId: DOC, action: 'acknowledge', ttlDays: 1 }, NOW,
    );
    const later = new Date(NOW.getTime() + 2 * 86400_000);
    expect(verifyAlertToken(token, later)).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts a token right up to its expiry', () => {
    const token = createAlertToken(
      { alertId: ALERT, documentId: DOC, action: 'acknowledge', ttlDays: 1 }, NOW,
    );
    const justBefore = new Date(NOW.getTime() + 86400_000 - 1000);
    expect(verifyAlertToken(token, justBefore).ok).toBe(true);
  });

  it.each(['', 'nonsense', 'a.b.c', 'no-dot', '.', 'eyJhIjoxfQ'])(
    'rejects malformed input %j', (bad) => {
      expect(verifyAlertToken(bad, NOW).ok).toBe(false);
    },
  );

  it('binds the token to one action - acknowledge cannot be replayed as renew', () => {
    const ack = verifyAlertToken(make({ action: 'acknowledge' }), NOW);
    const renew = verifyAlertToken(make({ action: 'renew' }), NOW);
    expect(ack.ok && ack.payload.t).toBe('acknowledge');
    expect(renew.ok && renew.payload.t).toBe('renew');
    // and the two tokens are not interchangeable
    expect(make({ action: 'acknowledge' })).not.toBe(make({ action: 'renew' }));
  });

  it('binds the token to one alert and one document', () => {
    const a = make();
    const b = make({ alertId: 'cccccccc-0000-4000-8000-000000000003' });
    const c = make({ documentId: 'eeeeeeee-0000-4000-8000-000000000004' });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('rejects an unknown action smuggled into a correctly signed payload', () => {
    // Someone with the secret is game over anyway, but this guards against
    // a future code path minting an action the handler does not expect.
    const payload = { a: ALERT, d: DOC, t: 'delete_everything', e: 9999999999 };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const { createHmac } = require('node:crypto');
    const sig = createHmac('sha256', process.env.CRON_SECRET!).update(body).digest('base64url');
    expect(verifyAlertToken(`${body}.${sig}`, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('produces url-safe tokens', () => {
    const token = make();
    expect(token).toBe(encodeURIComponent(token).replace(/%2E/g, '.'));
    expect(token).not.toMatch(/[+/=]/);
  });
});
