/**
 * PII scrubbing for anything that leaves this process as text.
 *
 * This app holds passport, visa and Emirates ID scans. A stack trace with a
 * holder's name in it, or a storage path containing an org and document id,
 * is a data leak the moment it reaches a log aggregator or an error tracker
 * - and those are exactly the places nobody thinks to check.
 *
 * The rule is that no raw error, object or path is ever handed to console.
 * Everything goes through `log`, which scrubs first. `scrub` is exported
 * separately so it can be unit tested against the shapes that actually
 * occur here.
 */

/** Storage keys look like {org}/{entity}/{document}/{ts}-{filename}. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** E.164 and the loose local forms people actually type. */
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
/** Emirates ID: 784-YYYY-NNNNNNN-N */
const EMIRATES_ID = /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g;
/** Anything that looks like a storage object key. */
const STORAGE_PATH = /\b[\w-]+\/[\w-]+\/[\w-]+\/[^\s"']+\.(pdf|jpe?g|png|webp|gif|heic)\b/gi;
/** Supabase/Stripe/Anthropic secrets, in case one lands in an error string. */
const SECRETS = /\b(eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}|sk_(live|test)_[\w]{10,}|whsec_[\w]{10,}|sbp_[0-9a-f]{20,}|sk-ant-[\w-]{10,})\b/g;
/** Base64 blobs - an inlined scan would otherwise dump megabytes of PII. */
const BASE64_BLOB = /[A-Za-z0-9+/]{200,}={0,2}/g;

/** Field names whose VALUES are personal data, whatever they contain. */
const PII_KEYS = new Set([
  'holder_name', 'holdername', 'full_name', 'fullname', 'name',
  'email', 'recipient_email', 'responsible_email', 'notification_email',
  'phone', 'phone_e164', 'document_number', 'documentnumber', 'identifier',
  'trade_licence_number', 'notes', 'file_path', 'filepath', 'file_name',
  'filename', 'data', 'content', 'raw_response', 'parsed_output',
  'password', 'token', 'access_token', 'refresh_token', 'apikey', 'api_key',
  'authorization', 'cookie', 'signature',
]);

const MAX_STRING = 400;

/** Redact PII patterns inside a free-text string. */
export function scrubString(value: string): string {
  let out = value
    .replace(BASE64_BLOB, '[blob]')
    .replace(SECRETS, '[secret]')
    .replace(EMIRATES_ID, '[emirates-id]')
    .replace(STORAGE_PATH, '[file]')
    .replace(EMAIL, '[email]')
    .replace(UUID, '[id]')
    .replace(PHONE, '[phone]');

  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…[truncated]`;
  return out;
}

/**
 * Deep-scrub any value into something safe to log.
 *
 * Keys named in PII_KEYS are dropped entirely rather than pattern-matched,
 * because a holder's name is personal data whether or not it looks like
 * one. Everything else is still pattern-scrubbed, because PII turns up
 * under keys nobody predicted.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 6) return '[deep]';

  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[fn]';

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      // Stack frames carry file paths and sometimes interpolated values.
      stack: value.stack ? scrubString(value.stack.split('\n').slice(0, 4).join(' | ')) : undefined,
    };
  }

  if (Buffer.isBuffer(value)) return `[buffer ${value.byteLength}b]`;
  if (value instanceof Uint8Array) return `[bytes ${value.byteLength}]`;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    const head = value.slice(0, 20).map((v) => scrub(v, depth + 1));
    return value.length > 20 ? [...head, `[+${value.length - 20} more]`] : head;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.has(key.toLowerCase())) {
        out[key] = '[redacted]';
        continue;
      }
      out[key] = scrub(inner, depth + 1);
    }
    return out;
  }

  return '[unknown]';
}

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, message: string, context?: unknown) {
  const line = `[${scope}] ${scrubString(message)}`;
  const payload = context === undefined ? undefined : scrub(context);
  // eslint-disable-next-line no-console
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (payload === undefined) fn(line);
  else fn(line, payload);
}

/**
 * The only logger this app uses.
 *
 * Anything shipped to a third-party error tracker should be wired here too,
 * so it inherits the same scrubbing rather than getting its own raw feed.
 */
export const log = {
  info: (scope: string, message: string, context?: unknown) => emit('info', scope, message, context),
  warn: (scope: string, message: string, context?: unknown) => emit('warn', scope, message, context),
  error: (scope: string, message: string, context?: unknown) => emit('error', scope, message, context),
};

/**
 * Reduce a storage key to something safe to show in an error or a log:
 * the file extension and nothing else.
 */
export function describeFile(path: string | null | undefined): string {
  if (!path) return 'no file';
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{2,5}$/.test(ext) ? `a .${ext} file` : 'a file';
}
