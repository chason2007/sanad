import { describe, it, expect, vi, afterEach } from 'vitest';
import { scrub, scrubString, log, describeFile } from '@/lib/privacy';

const ORG = 'b374e73f-9803-4288-8531-085c6bc5e859';
const DOC = '42f1e2d5-00f5-4bed-996d-1e55a6225e71';
const PATH = `${ORG}/8f54bf93-df7c-4026-8749-873e7467e8d3/${DOC}/1789013478710-passport-scan.pdf`;

const str = (v: unknown) => JSON.stringify(scrub(v));

afterEach(() => vi.restoreAllMocks());

describe('scrubString', () => {
  it('removes storage paths', () => {
    const out = scrubString(`Could not store the file: ${PATH}`);
    expect(out).not.toContain(ORG);
    expect(out).not.toContain('passport-scan');
    expect(out).toContain('[file]');
  });

  it('removes uuids', () => {
    expect(scrubString(`document ${DOC} failed`)).toBe('document [id] failed');
  });

  it('removes email addresses', () => {
    expect(scrubString('failed for fatima@alnoor.ae')).toBe('failed for [email]');
  });

  it('removes Emirates ID numbers', () => {
    expect(scrubString('id 784-1990-1234567-1 rejected')).toContain('[emirates-id]');
    expect(scrubString('id 784 1990 1234567 1 rejected')).toContain('[emirates-id]');
  });

  it('removes phone numbers', () => {
    expect(scrubString('call +971 50 123 4567 now')).toContain('[phone]');
  });

  it('removes credentials that leak into error strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmno';
    expect(scrubString(`bad key ${jwt}`)).toContain('[secret]');
    expect(scrubString('sk_live_abcdefghijklmnop failed')).toContain('[secret]');
    expect(scrubString('sk-ant-api03-abcdefghijk rejected')).toContain('[secret]');
  });

  it('collapses base64 blobs instead of dumping a scan into the log', () => {
    const blob = 'A'.repeat(5000);
    const out = scrubString(`payload ${blob}`);
    expect(out.length).toBeLessThan(500);
    expect(out).toContain('[blob]');
  });

  it('truncates very long strings', () => {
    // Spaces so it is not caught by the base64 rule first - that path is
    // covered above and collapses to [blob], which is also fine.
    expect(scrubString('word '.repeat(2_000))).toMatch(/\[truncated\]$/);
  });
});

describe('scrub - object shapes that actually occur here', () => {
  it('redacts personal fields by name, whatever they contain', () => {
    const out = str({
      holder_name: 'Fatima Al Marzooqi',
      document_number: '784-1990-1234567-1',
      email: 'f@x.ae',
      phone_e164: '+971501234567',
      notes: 'renewed at the DHA centre',
      file_path: PATH,
      status: 'valid',
      lead_day: 7,
    });
    expect(out).not.toContain('Fatima');
    expect(out).not.toContain('784-1990');
    expect(out).not.toContain('f@x.ae');
    expect(out).not.toContain('renewed at the DHA');
    expect(out).toContain('[redacted]');
    // Non-personal operational fields survive, or the log is useless.
    expect(out).toContain('valid');
    expect(out).toContain('7');
  });

  it('redacts a nested extraction payload', () => {
    const out = str({
      job: { id: 'j1', raw_response: { parsed_output: { holder_name: 'Rajesh Kumar' } } },
    });
    expect(out).not.toContain('Rajesh');
  });

  it('never dumps a file buffer', () => {
    expect(str({ data: Buffer.alloc(2_000_000) })).not.toContain('AAAA');
    expect(str({ bytes: Buffer.from('passport') })).toContain('[buffer');
  });

  it('scrubs an Error and keeps only a short stack', () => {
    const err = new Error(`upload failed for ${PATH}`);
    const out = scrub(err) as any;
    expect(out.message).not.toContain(ORG);
    expect(out.message).toContain('[file]');
    expect(out.stack.split('|').length).toBeLessThanOrEqual(4);
  });

  it('caps arrays so a bulk failure cannot dump the whole register', () => {
    const out = scrub(Array.from({ length: 500 }, (_, i) => i)) as unknown[];
    expect(out.length).toBeLessThanOrEqual(21);
    expect(String(out[out.length - 1])).toContain('more');
  });

  it('survives circular and exotic values', () => {
    const circular: any = { a: 1 };
    circular.self = circular;
    expect(() => scrub(circular)).not.toThrow();
    expect(() => scrub(new Map([['k', 'v']]))).not.toThrow();
    expect(scrub(undefined)).toBeUndefined();
    expect(scrub(null)).toBeNull();
  });

  it('scrubs PII appearing under an unexpected key', () => {
    // Belt and braces: the key list cannot anticipate every field.
    const out = str({ some_future_field: `see ${PATH} for fatima@alnoor.ae` });
    expect(out).not.toContain('alnoor.ae');
    expect(out).not.toContain(ORG);
  });
});

describe('log', () => {
  it('scrubs both the message and the context', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('upload', `failed for ${PATH}`, { holder_name: 'Fatima', err: new Error(DOC) });

    const printed = spy.mock.calls[0].map((a) => JSON.stringify(a)).join(' ');
    expect(printed).not.toContain(ORG);
    expect(printed).not.toContain(DOC);
    expect(printed).not.toContain('Fatima');
    expect(printed).toContain('[upload]');
  });

  it('logs a bare message with no context object', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('cron', 'run finished');
    expect(spy).toHaveBeenCalledWith('[cron] run finished');
  });
});

describe('describeFile', () => {
  it('reduces a storage key to its type', () => {
    expect(describeFile(PATH)).toBe('a .pdf file');
    expect(describeFile(null)).toBe('no file');
    expect(describeFile(`${ORG}/x/y/scan.jpeg`)).toBe('a .jpeg file');
  });

  it('leaks nothing identifying', () => {
    expect(describeFile(PATH)).not.toContain(ORG);
    expect(describeFile(PATH)).not.toContain('passport');
  });
});
