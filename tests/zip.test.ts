import { describe, it, expect } from 'vitest';
import { createZip, zipSafeName } from '@/lib/zip';
import { crc32, inflateRawSync } from 'node:zlib';

const NOW = new Date('2026-09-10T10:00:00Z');

/** Read the archive back the way a real unzip does: via the central directory. */
function readZip(buf: Buffer) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(-1);

  const count = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  expect(centralOffset + centralSize).toBe(eocd);

  const files: Array<{ name: string; content: Buffer; method: number }> = [];
  let p = centralOffset;

  for (let i = 0; i < count; i += 1) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const storedCrc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    // Follow the pointer into the local header, as an extractor would.
    expect(buf.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const body = buf.subarray(dataStart, dataStart + compSize);

    const content = method === 8 ? inflateRawSync(body) : body;
    expect(content.length).toBe(rawSize);
    expect(crc32(content)).toBe(storedCrc);

    files.push({ name, content, method });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }

  return files;
}

describe('zip writer', () => {
  it('round-trips text entries', () => {
    const zip = createZip([
      { path: 'organization.json', data: '{"name":"Al Noor"}' },
      { path: 'documents.csv', data: 'a,b\n1,2\n' },
    ], NOW);

    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(['organization.json', 'documents.csv']);
    expect(files[0].content.toString()).toBe('{"name":"Al Noor"}');
    expect(files[1].content.toString()).toBe('a,b\n1,2\n');
  });

  it('stores already-compressed files instead of re-deflating them', () => {
    const pdf = Buffer.from('%PDF-1.7 binary-ish content here');
    const files = readZip(createZip([
      { path: 'files/passport.pdf', data: pdf },
      { path: 'notes.txt', data: 'x'.repeat(1000) },
    ], NOW));

    expect(files[0].method).toBe(0); // stored
    expect(files[1].method).toBe(8); // deflated
    expect(files[0].content.equals(pdf)).toBe(true);
  });

  it('actually compresses repetitive text', () => {
    const big = 'compliance '.repeat(5000);
    const zip = createZip([{ path: 'big.txt', data: big }], NOW);
    expect(zip.length).toBeLessThan(big.length / 5);
    expect(readZip(zip)[0].content.toString()).toBe(big);
  });

  it('preserves nested paths and binary bytes exactly', () => {
    const bytes = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256));
    const files = readZip(createZip([
      { path: 'files/entity/scan.bin', data: bytes, store: true },
    ], NOW));
    expect(files[0].name).toBe('files/entity/scan.bin');
    expect(files[0].content.equals(bytes)).toBe(true);
  });

  it('handles UTF-8 names', () => {
    const files = readZip(createZip([{ path: 'شركة/تقرير.txt', data: 'ok' }], NOW));
    expect(files[0].name).toBe('شركة/تقرير.txt');
  });

  it('produces a valid empty archive', () => {
    const zip = createZip([], NOW);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toHaveLength(0);
  });

  it('refuses to silently emit a broken archive past the zip64 boundary', () => {
    // Better a clear failure than a file that unzips to garbage.
    const huge = { path: 'x', data: Buffer.alloc(1), store: true } as const;
    const spy = { ...huge };
    Object.defineProperty(spy.data, 'length', { value: 0x100000000 });
    expect(() => createZip([spy])).toThrow(/too large/i);
  });
});

describe('zipSafeName', () => {
  it('makes a company name safe as a folder', () => {
    expect(zipSafeName('Al Noor Contracting LLC')).toBe('Al-Noor-Contracting-LLC');
    expect(zipSafeName('A/B:C*D?')).toBe('A-B-C-D-');
    expect(zipSafeName('')).toBe('file');
  });

  it('caps the length', () => {
    expect(zipSafeName('x'.repeat(300)).length).toBeLessThanOrEqual(80);
  });
});
