import React from 'react';
import {
  Document, Page, Text, View, StyleSheet, renderToBuffer,
} from '@react-pdf/renderer';
import { daysUntil, formatDate, MONTH_LABEL, dubaiToday } from '@/lib/dates';
import type { RegisterRow } from '@/lib/types';

/**
 * The monthly compliance report: exactly one page, per entity.
 *
 * Management will not read two pages, so the row budget below is enforced
 * rather than hoped for. react-pdf will happily paginate; the only way to
 * guarantee a single page is to cap what goes on it and say honestly how
 * much was left off.
 *
 * Same font caveat as the on-demand report: the built-in Helvetica has no
 * Arabic coverage, so names in Arabic are transliterated where possible and
 * marked otherwise. The CSV export carries them intact.
 */

// A4 is 842pt tall. 40pt margins, minus header/stats/footer, leaves room
// for roughly this many table rows across both sections.
const ROW_BUDGET = 22;

const C = {
  ink: '#131a22',
  muted: '#5a6673',
  faint: '#98a2ad',
  rule: '#e2e8ee',
  danger: '#8c1d1d',
  dangerBg: '#fdecec',
  warn: '#8a5a12',
  warnBg: '#fdf3e2',
  ok: '#1c6b4a',
  okBg: '#eaf6f0',
  brand: '#0b5f80',
};

const s = StyleSheet.create({
  page: { paddingVertical: 40, paddingHorizontal: 40, fontSize: 9, color: C.ink, fontFamily: 'Helvetica' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  entity: { fontSize: 17, fontFamily: 'Helvetica-Bold' },
  org: { fontSize: 9, color: C.muted, marginTop: 3 },
  period: { fontSize: 9, color: C.muted, textAlign: 'right' },
  rule: { borderBottomWidth: 1, borderBottomColor: C.rule, marginTop: 12, marginBottom: 14 },

  band: { flexDirection: 'row', gap: 10 },
  score: { width: 150, padding: 12, borderRadius: 5 },
  scoreNum: { fontSize: 30, fontFamily: 'Helvetica-Bold' },
  scoreLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', letterSpacing: 0.6, marginBottom: 2 },
  scoreNote: { fontSize: 7, marginTop: 3 },

  tiles: { flex: 1, flexDirection: 'row', gap: 8 },
  tile: { flex: 1, padding: 10, borderWidth: 1, borderColor: C.rule, borderRadius: 5 },
  tileLabel: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5, color: C.muted },
  tileNum: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginTop: 4 },

  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 5 },
  sectionCount: { fontSize: 9, color: C.muted, fontFamily: 'Helvetica' },

  th: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.rule, paddingBottom: 3 },
  thText: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5, color: C.muted },
  // Fixed height, not padding. A wrapped cell would otherwise grow the row
  // and push the report onto a second page; a fixed height makes the row
  // budget arithmetic actually hold whatever the data looks like.
  tr: {
    flexDirection: 'row', height: 14, alignItems: 'center',
    borderBottomWidth: 0.5, borderBottomColor: '#f1f4f7', overflow: 'hidden',
  },

  // Every cell is clamped to one line. A wrapped cell is a taller row, and
  // a taller row silently breaks the one-page guarantee - which is exactly
  // what the long-name test caught.
  cHolder: { width: '28%', paddingRight: 6, textOverflow: 'ellipsis' },
  cDoc: { width: '27%', paddingRight: 6, textOverflow: 'ellipsis' },
  cDate: { width: '16%', textOverflow: 'ellipsis' },
  cDays: { width: '10%' },
  // Wider than it looks like it needs: a truncated owner name is useless -
  // the whole point of the column is knowing who to chase.
  cWho: { width: '19%', paddingRight: 4, textOverflow: 'ellipsis' },

  empty: { fontSize: 8.5, color: C.muted, paddingVertical: 6 },
  more: { fontSize: 7.5, color: C.faint, paddingTop: 4 },

  footer: {
    position: 'absolute', bottom: 26, left: 40, right: 40,
    borderTopWidth: 1, borderTopColor: C.rule, paddingTop: 7,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  footerText: { fontSize: 6.5, color: C.faint },
});

/**
 * Hard character budgets per column.
 *
 * react-pdf's maxLines/textOverflow did not clamp reliably here, and a cell
 * that wraps makes its row taller, which silently pushes the report onto a
 * second page. Truncating the string is deterministic and does not depend
 * on renderer behaviour. Widths derived from the 515pt content width at 9pt
 * Helvetica (~4.5pt average glyph).
 */
const CLIP = { holder: 26, doc: 26, who: 18 };

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Helvetica is WinAnsi; strip what it cannot draw rather than emit tofu. */
function safe(value: string | null | undefined): string {
  if (!value) return '';
  const folded = value.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  let dropped = false;
  const out = folded
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      const keep = (c >= 32 && c <= 126) || (c >= 160 && c <= 255);
      if (!keep) dropped = true;
      return keep;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (out) return out;
  return dropped ? '[name in Arabic - see CSV]' : '';
}

export interface EntityReportInput {
  organizationName: string;
  entityName: string;
  rows: RegisterRow[];
  now?: Date;
}

export interface ReportStats {
  total: number;
  expired: number;
  dueIn60: number;
  valid: number;
  compliancePercent: number;
}

/**
 * Compliance = the share of live documents that have not lapsed.
 *
 * Deliberately not "everything not expiring soon" - a document due in three
 * weeks is still compliant today, and counting it against the score would
 * make the number impossible to keep at 100% and therefore ignorable.
 */
export function computeStats(rows: RegisterRow[], now: Date): ReportStats {
  const live = rows.filter((r) => r.status !== 'archived' && r.status !== 'renewed');
  let expired = 0, dueIn60 = 0, valid = 0;

  for (const r of live) {
    const d = daysUntil(r.expiry_date, now);
    if (d < 0) expired += 1;
    else if (d <= 60) dueIn60 += 1;
    else valid += 1;
  }

  const total = live.length;
  const compliancePercent = total === 0 ? 100 : Math.round(((total - expired) / total) * 100);
  return { total, expired, dueIn60, valid, compliancePercent };
}

function scoreTone(pct: number) {
  if (pct === 100) return { bg: C.okBg, fg: C.ok };
  if (pct >= 90) return { bg: C.warnBg, fg: C.warn };
  return { bg: C.dangerBg, fg: C.danger };
}

function Row({ row, now }: { row: RegisterRow; now: Date }) {
  const d = daysUntil(row.expiry_date, now);
  return (
    <View style={s.tr} wrap={false}>
      <Text style={s.cHolder}>
        {clip(safe(row.holder_name) || safe(row.entity_name), CLIP.holder)}
      </Text>
      <Text style={s.cDoc}>{clip(safe(row.document_type_label), CLIP.doc)}</Text>
      <Text style={s.cDate}>{formatDate(row.expiry_date)}</Text>
      <Text style={{ ...s.cDays, color: d < 0 ? C.danger : d <= 30 ? C.warn : C.ink }}>
        {d < 0 ? `${Math.abs(d)}d ago` : `${d}d`}
      </Text>
      <Text style={s.cWho}>{clip(safe(row.responsible_name) || '--', CLIP.who)}</Text>
    </View>
  );
}

function Head() {
  return (
    <View style={s.th}>
      <Text style={{ ...s.thText, ...s.cHolder }}>HOLDER</Text>
      <Text style={{ ...s.thText, ...s.cDoc }}>DOCUMENT</Text>
      <Text style={{ ...s.thText, ...s.cDate }}>EXPIRES</Text>
      <Text style={{ ...s.thText, ...s.cDays }}>LEFT</Text>
      <Text style={{ ...s.thText, ...s.cWho }}>OWNER</Text>
    </View>
  );
}

export function EntityReport({ organizationName, entityName, rows, now }: Required<EntityReportInput>) {
  const today = dubaiToday(now);
  const stats = computeStats(rows, now);
  const tone = scoreTone(stats.compliancePercent);

  const live = rows.filter((r) => r.status !== 'archived' && r.status !== 'renewed');
  const expired = live
    .filter((r) => daysUntil(r.expiry_date, now) < 0)
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
  const upcoming = live
    .filter((r) => { const d = daysUntil(r.expiry_date, now); return d >= 0 && d <= 60; })
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));

  // Expired rows earn their space first: they are the ones costing money.
  const expiredShown = expired.slice(0, Math.min(expired.length, ROW_BUDGET));
  const upcomingShown = upcoming.slice(0, Math.max(ROW_BUDGET - expiredShown.length, 0));

  return (
    <Document title={`Compliance report - ${entityName} - ${MONTH_LABEL(today)}`} author="Sanad">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.entity}>{clip(safe(entityName), 44)}</Text>
            <Text style={s.org}>{clip(safe(organizationName), 60)}</Text>
          </View>
          <View>
            <Text style={s.period}>Compliance report</Text>
            <Text style={s.period}>{MONTH_LABEL(today)}</Text>
          </View>
        </View>
        <View style={s.rule} />

        <View style={s.band}>
          <View style={{ ...s.score, backgroundColor: tone.bg }}>
            <Text style={{ ...s.scoreLabel, color: tone.fg }}>COMPLIANT</Text>
            <Text style={{ ...s.scoreNum, color: tone.fg }}>{stats.compliancePercent}%</Text>
            <Text style={{ ...s.scoreNote, color: tone.fg }}>
              {stats.expired === 0
                ? 'Nothing has lapsed'
                : `${stats.expired} document${stats.expired === 1 ? '' : 's'} lapsed`}
            </Text>
          </View>

          <View style={s.tiles}>
            {[
              ['EXPIRED', stats.expired, C.danger],
              ['DUE IN 60 DAYS', stats.dueIn60, C.warn],
              ['VALID', stats.valid, C.ok],
              ['TRACKED', stats.total, C.ink],
            ].map(([label, value, colour]) => (
              <View key={String(label)} style={s.tile}>
                <Text style={s.tileLabel}>{String(label)}</Text>
                <Text style={{ ...s.tileNum, color: String(colour) }}>{String(value)}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={s.sectionTitle}>
          Expired - action required <Text style={s.sectionCount}>{expired.length}</Text>
        </Text>
        {expiredShown.length === 0 ? (
          <Text style={s.empty}>Nothing has lapsed.</Text>
        ) : (
          <View>
            <Head />
            {expiredShown.map((r) => <Row key={r.id} row={r} now={now} />)}
            {expired.length > expiredShown.length && (
              <Text style={s.more}>+ {expired.length - expiredShown.length} more in the register</Text>
            )}
          </View>
        )}

        <Text style={s.sectionTitle}>
          Expiring in the next 60 days <Text style={s.sectionCount}>{upcoming.length}</Text>
        </Text>
        {upcomingShown.length === 0 ? (
          <Text style={s.empty}>Nothing expires in the next 60 days.</Text>
        ) : (
          <View>
            <Head />
            {upcomingShown.map((r) => <Row key={r.id} row={r} now={now} />)}
            {upcoming.length > upcomingShown.length && (
              <Text style={s.more}>+ {upcoming.length - upcomingShown.length} more in the register</Text>
            )}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Sanad · generated {formatDate(today)} · dates are Asia/Dubai
          </Text>
          <Text style={s.footerText} render={({ pageNumber }) => `Page ${pageNumber}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderEntityReport(input: EntityReportInput): Promise<Buffer> {
  const now = input.now ?? new Date();
  return renderToBuffer(
    <EntityReport
      organizationName={input.organizationName}
      entityName={input.entityName}
      rows={input.rows}
      now={now}
    />,
  );
}
