import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A minimal ZIP writer.
 *
 * Deliberately hand-rolled rather than pulling in an archiver: the format
 * we need is small and completely specified, and the export path handles
 * passport scans - fewer third parties touching that byte stream is worth
 * a hundred lines. Node ships crc32 and raw deflate, which is everything
 * the format actually requires.
 *
 * Produces a standard deflate/store archive that Windows Explorer, macOS
 * Archive Utility and `unzip` all read. No zip64: an export past 4GB should
 * be paginated rather than silently produce a broken file, so we throw.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_LIMIT = 0xffffffff;

export interface ZipEntry {
  path: string;
  data: Buffer | string;
  /** Skip deflate for already-compressed bytes (PDF, JPEG, PNG). */
  store?: boolean;
}

/** MS-DOS date/time, which is what the format stores. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time:
      (Math.floor(date.getSeconds() / 2) & 0x1f) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((date.getHours() & 0x1f) << 11),
    date:
      (date.getDate() & 0x1f) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      (((year - 1980) & 0x7f) << 9),
  };
}

const ALREADY_COMPRESSED = /\.(pdf|jpe?g|png|webp|gif|heic|zip)$/i;

export function createZip(entries: ZipEntry[], now: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const store = entry.store ?? ALREADY_COMPRESSED.test(entry.path);

    const body = store ? raw : deflateRawSync(raw);
    const method = store ? 0 : 8;
    const sum = crc32(raw);

    if (raw.length > ZIP64_LIMIT || body.length > ZIP64_LIMIT) {
      throw new Error(`"${entry.path}" is too large for a zip64-free archive.`);
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 filename flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);          // no extra field

    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);        // version made by
    central.writeUInt16LE(20, 6);        // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);        // extra
    central.writeUInt16LE(0, 32);        // comment
    central.writeUInt16LE(0, 34);        // disk number
    central.writeUInt16LE(0, 36);        // internal attrs
    central.writeUInt32LE(0, 38);        // external attrs
    central.writeUInt32LE(offset, 42);

    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);                    // disk
  eocd.writeUInt16LE(0, 6);                    // start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);                   // comment length

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/**
 * Filesystem-safe archive member name.
 *
 * Two explicit passes rather than one clever character class: the set
 * Windows reserves, then whitespace. Non-ASCII is left alone - the archive
 * is flagged UTF-8, so an Arabic company name should survive into the
 * folder name rather than becoming a row of dashes.
 */
export function zipSafeName(value: string, fallback = 'file'): string {
  const cleaned = value
    .replace(/[<>:"/\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return cleaned || fallback;
}
