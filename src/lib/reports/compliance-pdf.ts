import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { daysUntil, dubaiToday, formatDate, MONTH_LABEL } from '@/lib/dates';
import { summarise } from '@/lib/register';
import type { RegisterRow } from '@/lib/types';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 44;
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.46, 0.53);
const RULE = rgb(0.84, 0.87, 0.9);
const DANGER = rgb(0.72, 0.13, 0.13);
const WARN = rgb(0.68, 0.42, 0.05);
const OK = rgb(0.13, 0.45, 0.31);

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage(A4);
  ctx.y = A4[1] - MARGIN;
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 24) newPage(ctx);
}

function text(
  ctx: Ctx, value: string,
  opts: { x?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {},
) {
  const size = opts.size ?? 9.5;
  ctx.page.drawText(value, {
    x: opts.x ?? MARGIN,
    y: ctx.y,
    size,
    font: opts.bold ? ctx.bold : ctx.regular,
    color: opts.color ?? INK,
  });
}

/** Trim a string to fit a column, since pdf-lib will happily overflow. */
function fit(ctx: Ctx, value: string, width: number, size = 9, bold = false): string {
  const font = bold ? ctx.bold : ctx.regular;
  let out = value ?? '';
  if (font.widthOfTextAtSize(out, size) <= width) return out;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > width) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

/**
 * ASCII-fold for the PDF only.
 *
 * pdf-lib's standard fonts are WinAnsi and throw on characters outside it,
 * which includes every Arabic holder name in the register. Embedding a font
 * with Arabic coverage would mean shipping a several-hundred-KB TTF and
 * still not solve right-to-left shaping, so the report transliterates what
 * it can and marks the rest. The CSV export is UTF-8 and carries the real
 * names - that is the path for anyone who needs them intact.
 */
function pdfSafe(value: string | null | undefined): string {
  if (!value) return '';
  const normalized = value.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  let hadUnsupported = false;
  const cleaned = normalized
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code >= 32 && code <= 126) return char;
      if (code >= 160 && code <= 255) return char;
      hadUnsupported = true;
      return '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned) return cleaned;
  return hadUnsupported ? '[name in Arabic - see CSV]' : '';
}

export interface ReportInput {
  organizationName: string;
  rows: RegisterRow[];
  entityFilter?: string | null;
  now?: Date;
}

export async function buildComplianceReport(input: ReportInput): Promise<Uint8Array> {
  const now = input.now ?? new Date();
  const today = dubaiToday(now);

  const rows = input.entityFilter
    ? input.rows.filter((r) => r.entity_id === input.entityFilter)
    : input.rows;

  const live = rows.filter((r) => r.status !== 'renewed' && r.status !== 'archived');
  const summary = summarise(rows, now);

  const doc = await PDFDocument.create();
  doc.setTitle(`Compliance report - ${input.organizationName} - ${MONTH_LABEL(today)}`);
  doc.setCreator('Sanad');
  doc.setProducer('Sanad');

  const ctx: Ctx = {
    doc,
    page: doc.addPage(A4),
    y: A4[1] - MARGIN,
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  // ---------- header ----------
  text(ctx, 'Compliance report', { size: 19, bold: true });
  ctx.y -= 17;
  text(ctx, pdfSafe(input.organizationName), { size: 11, color: MUTED });
  ctx.y -= 13;
  text(ctx, `${MONTH_LABEL(today)} · generated ${formatDate(today)} (Asia/Dubai)`, {
    size: 8.5, color: MUTED,
  });
  ctx.y -= 18;

  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y }, end: { x: A4[0] - MARGIN, y: ctx.y },
    thickness: 1, color: RULE,
  });
  ctx.y -= 24;

  // ---------- counters ----------
  const tiles = [
    { label: 'Expired', value: summary.expired, color: DANGER },
    { label: 'Due in 7 days', value: summary.dueIn7, color: DANGER },
    { label: 'Due in 30 days', value: summary.dueIn30, color: WARN },
    { label: 'Valid', value: summary.valid, color: OK },
  ];

  const tileWidth = (A4[0] - MARGIN * 2 - 12 * 3) / 4;
  tiles.forEach((tile, index) => {
    const x = MARGIN + index * (tileWidth + 12);
    ctx.page.drawRectangle({
      x, y: ctx.y - 44, width: tileWidth, height: 52,
      borderColor: RULE, borderWidth: 1, color: rgb(0.985, 0.988, 0.992),
    });
    ctx.page.drawText(tile.label.toUpperCase(), {
      x: x + 9, y: ctx.y - 4, size: 6.5, font: ctx.bold, color: MUTED,
    });
    ctx.page.drawText(String(tile.value), {
      x: x + 9, y: ctx.y - 32, size: 22, font: ctx.bold, color: tile.color,
    });
  });
  ctx.y -= 62;

  text(ctx, `${summary.total} documents tracked. The 30-day count includes the 7-day count.`, {
    size: 8, color: MUTED,
  });
  ctx.y -= 26;

  // ---------- sections ----------
  const expired = live
    .filter((r) => daysUntil(r.expiry_date, now) < 0)
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));

  const upcoming = live
    .filter((r) => {
      const d = daysUntil(r.expiry_date, now);
      return d >= 0 && d <= 90;
    })
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));

  drawSection(ctx, 'Expired - action required', expired, now, DANGER,
    'Nothing has lapsed. ');
  drawSection(ctx, 'Expiring in the next 90 days', upcoming, now, INK,
    'Nothing expires in the next 90 days. ');

  // ---------- by entity ----------
  const byEntity = new Map<string, { total: number; expired: number; soon: number }>();
  for (const row of live) {
    const entry = byEntity.get(row.entity_name) ?? { total: 0, expired: 0, soon: 0 };
    entry.total += 1;
    const d = daysUntil(row.expiry_date, now);
    if (d < 0) entry.expired += 1;
    else if (d <= 30) entry.soon += 1;
    byEntity.set(row.entity_name, entry);
  }

  if (byEntity.size > 1) {
    ensure(ctx, 40 + byEntity.size * 14);
    text(ctx, 'By company', { size: 12, bold: true });
    ctx.y -= 16;
    drawRow(ctx, ['Company', 'Tracked', 'Expired', 'Due in 30d'], [240, 70, 70, 80], true);

    for (const [name, stats] of byEntity) {
      ensure(ctx, 16);
      drawRow(
        ctx,
        [pdfSafe(name), String(stats.total), String(stats.expired), String(stats.soon)],
        [240, 70, 70, 80],
        false,
        stats.expired > 0 ? DANGER : INK,
      );
    }
    ctx.y -= 12;
  }

  // ---------- footer on every page ----------
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    page.drawText(
      `Sanad compliance report · ${pdfSafe(input.organizationName)} · page ${index + 1} of ${pages.length}`,
      { x: MARGIN, y: 26, size: 7.5, font: ctx.regular, color: MUTED },
    );
  });

  return doc.save();
}

function drawSection(
  ctx: Ctx, title: string, rows: RegisterRow[], now: Date,
  accent: ReturnType<typeof rgb>, emptyMessage: string,
) {
  ensure(ctx, 60);
  text(ctx, title, { size: 12, bold: true, color: accent });
  ctx.y -= 4;
  text(ctx, `${rows.length}`, { size: 12, bold: true, color: MUTED, x: MARGIN + ctx.bold.widthOfTextAtSize(title, 12) + 8 });
  ctx.y -= 14;

  if (!rows.length) {
    text(ctx, emptyMessage, { size: 9, color: MUTED });
    ctx.y -= 24;
    return;
  }

  const widths = [130, 120, 62, 48, 100];
  drawRow(ctx, ['Holder', 'Document', 'Expires', 'Days', 'Responsible'], widths, true);

  for (const row of rows) {
    ensure(ctx, 16);
    const days = daysUntil(row.expiry_date, now);
    drawRow(
      ctx,
      [
        pdfSafe(row.holder_name ?? row.entity_name),
        pdfSafe(row.document_type_label),
        formatDate(row.expiry_date),
        days < 0 ? `${Math.abs(days)} ago` : String(days),
        pdfSafe(row.responsible_name ?? 'Unassigned'),
      ],
      widths,
      false,
      days < 0 ? DANGER : days <= 30 ? WARN : INK,
    );
  }
  ctx.y -= 14;
}

function drawRow(
  ctx: Ctx, cells: string[], widths: number[], header: boolean,
  color: ReturnType<typeof rgb> = INK,
) {
  let x = MARGIN;
  const size = header ? 7 : 8.5;

  cells.forEach((cell, index) => {
    ctx.page.drawText(fit(ctx, header ? cell.toUpperCase() : cell, widths[index] - 6, size, header), {
      x, y: ctx.y, size,
      font: header ? ctx.bold : ctx.regular,
      color: header ? MUTED : color,
    });
    x += widths[index];
  });

  ctx.y -= header ? 4 : 13;

  if (header) {
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y }, end: { x: A4[0] - MARGIN, y: ctx.y },
      thickness: 0.75, color: RULE,
    });
    ctx.y -= 12;
  }
}
