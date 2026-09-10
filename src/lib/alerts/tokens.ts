import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

/**
 * Signed, tokenised action links for alert emails.
 *
 * The person who has to renew a visa is usually on their phone, often is not
 * the person who set up Sanad, and will not log in to acknowledge a
 * reminder. So the email carries links that authenticate on their own.
 *
 * Design rules, each of which exists because of a specific way this goes
 * wrong:
 *
 * - HMAC-SHA256 over a compact payload, verified with a constant-time
 *   compare. No database lookup is needed to know a link is genuine.
 * - Every token is scoped to ONE alert and ONE action. An acknowledge token
 *   cannot be replayed as a renew token, and neither can be pointed at a
 *   different document.
 * - Tokens expire. Someone forwarding a six-month-old email should not be
 *   able to mutate the register.
 * - The token grants exactly two narrow capabilities. It is not a session:
 *   it cannot read the register, list documents, or download a file.
 */

export type AlertAction = 'acknowledge' | 'renew';

export interface AlertTokenPayload {
  /** alert id */
  a: string;
  /** document id */
  d: string;
  /** action */
  t: AlertAction;
  /** expiry, unix seconds */
  e: number;
}

const DEFAULT_TTL_DAYS = 60;

/**
 * Link-signing secret.
 *
 * Separate from CRON_SECRET on purpose: they have different rotation
 * lifetimes. CRON_SECRET only has to match whatever Vercel sends today and
 * can be rotated freely; this one is baked into every link in every alert
 * email already in someone's inbox, so rotating it invalidates links people
 * are still expected to click.
 *
 * Falls back to CRON_SECRET so a minimal deployment works with one variable,
 * but set ALERT_LINK_SECRET in production.
 */
function secret(): string {
  const value = process.env.ALERT_LINK_SECRET || process.env.CRON_SECRET;
  if (!value) {
    throw new Error('ALERT_LINK_SECRET (or CRON_SECRET) is not set; alert links cannot be signed.');
  }
  return value;
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64url');

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function createAlertToken(
  params: { alertId: string; documentId: string; action: AlertAction; ttlDays?: number },
  now: Date = new Date(),
): string {
  const payload: AlertTokenPayload = {
    a: params.alertId,
    d: params.documentId,
    t: params.action,
    e: Math.floor(now.getTime() / 1000) + (params.ttlDays ?? DEFAULT_TTL_DAYS) * 86400,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export type TokenResult =
  | { ok: true; payload: AlertTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyAlertToken(token: string, now: Date = new Date()): TokenResult {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' };

  const [body, signature] = token.split('.');
  if (!body || !signature) return { ok: false, reason: 'malformed' };

  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }

  // Constant-time compare. A length mismatch is itself a mismatch, and
  // timingSafeEqual throws on unequal lengths, so check that first.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: AlertTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!payload?.a || !payload?.d || !payload?.t || typeof payload.e !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.t !== 'acknowledge' && payload.t !== 'renew') {
    return { ok: false, reason: 'malformed' };
  }
  if (Math.floor(now.getTime() / 1000) > payload.e) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, payload };
}

export function alertActionUrl(
  params: { alertId: string; documentId: string; action: AlertAction },
  now: Date = new Date(),
): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${base}/a/${createAlertToken(params, now)}`;
}

/** Used by the cron job to pre-generate an alert id before insert. */
export const newAlertId = () => randomUUID();
