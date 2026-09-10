import { formatDate } from '@/lib/dates';
import type { RenewalChecklist } from '@/lib/types';

/**
 * Alert emails.
 *
 * Written for a phone screen and an HR manager who is busy. The subject
 * line has to carry the whole message, because that is often all that gets
 * read: urgency, what the document is, and whose it is.
 *
 * HTML is table-based with inline styles. Outlook on Windows renders with
 * Word's engine, which ignores most modern CSS, and this audience is
 * squarely in Outlook territory. Every email also carries a plain-text
 * alternative - some corporate gateways strip HTML entirely.
 */

export interface AlertEmailInput {
  recipientName: string;
  documentTypeLabel: string;
  holderName: string | null;
  entityName: string;
  documentNumber: string | null;
  expiryDate: string;
  daysRemaining: number;
  checklist: RenewalChecklist | null;
  typicalLeadTimeDays: number | null;
  acknowledgeUrl: string;
  renewUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** "Expiring in 7 days: Emirates ID - Rajesh Kumar" */
export function alertSubject(
  daysRemaining: number, documentTypeLabel: string, holderName: string | null,
): string {
  const who = holderName ? ` — ${holderName}` : '';
  if (daysRemaining < 0) {
    const n = Math.abs(daysRemaining);
    return `EXPIRED ${n} day${n === 1 ? '' : 's'} ago: ${documentTypeLabel}${who}`;
  }
  if (daysRemaining === 0) return `Expires TODAY: ${documentTypeLabel}${who}`;
  if (daysRemaining === 1) return `Expires TOMORROW: ${documentTypeLabel}${who}`;
  return `Expiring in ${daysRemaining} days: ${documentTypeLabel}${who}`;
}

const esc = (value: string | null | undefined): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const OK_TONE = { bg: '#eaf6f0', ink: '#1c6b4a' };
const WARN_TONE = { bg: '#fdf3e2', ink: '#8a5a12' };
const DANGER_TONE = { bg: '#fdecec', ink: '#8c1d1d' };

function urgencyColour(days: number): { bg: string; ink: string; label: string } {
  if (days < 0) return { bg: '#fdecec', ink: '#8c1d1d', label: 'Expired' };
  if (days <= 7) return { bg: '#fdecec', ink: '#8c1d1d', label: 'Urgent' };
  if (days <= 30) return { bg: '#fdf3e2', ink: '#8a5a12', label: 'Due soon' };
  return { bg: '#eef4f8', ink: '#1f4b63', label: 'Upcoming' };
}

/** Table-based button: the only kind Outlook renders reliably. */
function button(href: string, label: string, primary: boolean): string {
  const bg = primary ? '#0b5f80' : '#ffffff';
  const fg = primary ? '#ffffff' : '#0b5f80';
  const border = primary ? '#0b5f80' : '#c7d4dc';
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-block;margin:0 8px 8px 0;">
  <tr><td align="center" bgcolor="${bg}" style="border:1px solid ${border};border-radius:6px;">
    <a href="${esc(href)}" style="display:inline-block;padding:12px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${fg};text-decoration:none;">${esc(label)}</a>
  </td></tr>
</table>`;
}

function daysPhrase(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export function renderAlertEmail(input: AlertEmailInput): RenderedEmail {
  const subject = alertSubject(input.daysRemaining, input.documentTypeLabel, input.holderName);
  const tone = urgencyColour(input.daysRemaining);
  const steps = input.checklist?.steps?.slice(0, 4) ?? [];
  const needed = input.checklist?.documents_required?.slice(0, 6) ?? [];

  const rows: Array<[string, string]> = [
    ['Document', input.documentTypeLabel],
    ...(input.holderName ? [['Holder', input.holderName] as [string, string]] : []),
    ['Company', input.entityName],
    ...(input.documentNumber ? [['Number', input.documentNumber] as [string, string]] : []),
    ['Expires', `${formatDate(input.expiryDate)} (${daysPhrase(input.daysRemaining)})`],
  ];

  const html = `<!-- Sanad alert -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f8;padding:24px 0;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e2e8ee;border-radius:10px;font-family:Arial,Helvetica,sans-serif;">

    <tr><td style="padding:20px 24px 0;">
      <span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${tone.bg};color:${tone.ink};font-size:12px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;">${esc(tone.label)}</span>
    </td></tr>

    <tr><td style="padding:14px 24px 0;">
      <div style="font-size:21px;font-weight:bold;color:#131a22;line-height:1.3;">${esc(input.documentTypeLabel)}${input.holderName ? ` — ${esc(input.holderName)}` : ''}</div>
      <div style="font-size:15px;color:#5a6673;padding-top:6px;">Expires <strong style="color:#131a22;">${esc(formatDate(input.expiryDate))}</strong> &middot; ${esc(daysPhrase(input.daysRemaining))}</div>
    </td></tr>

    <tr><td style="padding:20px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;color:#131a22;border-collapse:collapse;">
        ${rows.map(([k, v]) => `<tr>
          <td style="padding:7px 0;color:#5a6673;width:110px;vertical-align:top;">${esc(k)}</td>
          <td style="padding:7px 0;">${esc(v)}</td>
        </tr>`).join('')}
      </table>
    </td></tr>

    <tr><td style="padding:22px 24px 0;">
      ${button(input.renewUrl, 'Mark renewed', true)}${button(input.acknowledgeUrl, 'Acknowledge', false)}
      <div style="font-size:12px;color:#7b8794;padding-top:6px;">No sign-in needed. Acknowledging stops the reminder being escalated.</div>
    </td></tr>

    ${steps.length ? `<tr><td style="padding:24px 24px 0;">
      <div style="font-size:13px;font-weight:bold;color:#131a22;text-transform:uppercase;letter-spacing:.4px;">How to renew${input.typicalLeadTimeDays ? ` &middot; usually ${input.typicalLeadTimeDays} days` : ''}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding-top:8px;">
        ${steps.map((s, i) => `<tr><td style="padding:8px 0;border-top:1px solid #eef2f5;">
          <div style="font-size:14px;color:#131a22;"><strong>${i + 1}.</strong> ${esc(s.title)}</div>
          <div style="font-size:13px;color:#5a6673;padding:3px 0 0 16px;">${esc(s.detail)}</div>
          ${s.where ? `<div style="font-size:12px;color:#7b8794;padding:3px 0 0 16px;">${esc(s.where)}</div>` : ''}
        </td></tr>`).join('')}
      </table>
    </td></tr>` : ''}

    ${needed.length ? `<tr><td style="padding:18px 24px 0;">
      <div style="font-size:13px;font-weight:bold;color:#131a22;text-transform:uppercase;letter-spacing:.4px;">Bring with you</div>
      <div style="font-size:13px;color:#5a6673;padding-top:6px;line-height:1.7;">${needed.map((d) => `&bull; ${esc(d)}`).join('<br>')}</div>
    </td></tr>` : ''}

    <tr><td style="padding:24px;">
      <div style="border-top:1px solid #eef2f5;padding-top:14px;font-size:12px;color:#7b8794;">
        Sent by Sanad to ${esc(input.recipientName)}. Dates are Asia/Dubai.
      </div>
    </td></tr>

  </table>
</td></tr></table>`;

  const text = [
    subject,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Mark renewed:  ${input.renewUrl}`,
    `Acknowledge:   ${input.acknowledgeUrl}`,
    '',
    ...(steps.length ? ['How to renew:', ...steps.map((s, i) => `  ${i + 1}. ${s.title} - ${s.detail}${s.where ? ` (${s.where})` : ''}`)] : []),
    ...(needed.length ? ['', 'Bring with you:', ...needed.map((d) => `  - ${d}`)] : []),
    '',
    'Sent by Sanad. Dates are Asia/Dubai.',
  ].join('\n');

  return { subject, html, text };
}

export interface EscalationEmailInput {
  recipientName: string;
  originalRecipientName: string;
  documentTypeLabel: string;
  holderName: string | null;
  entityName: string;
  expiryDate: string;
  daysRemaining: number;
  hoursSinceSent: number;
  acknowledgeUrl: string;
  renewUrl: string;
}

export function renderEscalationEmail(input: EscalationEmailInput): RenderedEmail {
  const who = input.holderName ? ` — ${input.holderName}` : '';
  const subject = `Not acknowledged: ${input.documentTypeLabel}${who} (${daysPhrase(input.daysRemaining)})`;

  const html = `<!-- Sanad escalation -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f8;padding:24px 0;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e2e8ee;border-radius:10px;font-family:Arial,Helvetica,sans-serif;">
    <tr><td style="padding:20px 24px 0;">
      <span style="display:inline-block;padding:5px 11px;border-radius:999px;background:#fdecec;color:#8c1d1d;font-size:12px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;">Escalated</span>
    </td></tr>
    <tr><td style="padding:14px 24px 0;">
      <div style="font-size:21px;font-weight:bold;color:#131a22;line-height:1.3;">${esc(input.documentTypeLabel)}${input.holderName ? ` — ${esc(input.holderName)}` : ''}</div>
      <div style="font-size:15px;color:#5a6673;padding-top:8px;line-height:1.5;">
        ${esc(input.originalRecipientName)} was reminded ${input.hoursSinceSent} hours ago and has not acknowledged it.
        This ${esc(input.entityName)} document expires <strong style="color:#131a22;">${esc(formatDate(input.expiryDate))}</strong> (${esc(daysPhrase(input.daysRemaining))}).
      </div>
    </td></tr>
    <tr><td style="padding:22px 24px 24px;">
      ${button(input.renewUrl, 'Mark renewed', true)}${button(input.acknowledgeUrl, 'Acknowledge', false)}
      <div style="border-top:1px solid #eef2f5;margin-top:14px;padding-top:14px;font-size:12px;color:#7b8794;">
        Sent by Sanad to ${esc(input.recipientName)} as the escalation contact for ${esc(input.entityName)}. Dates are Asia/Dubai.
      </div>
    </td></tr>
  </table>
</td></tr></table>`;

  const text = [
    subject, '',
    `${input.originalRecipientName} was reminded ${input.hoursSinceSent} hours ago and has not acknowledged it.`,
    `${input.documentTypeLabel}${who} (${input.entityName}) expires ${formatDate(input.expiryDate)} - ${daysPhrase(input.daysRemaining)}.`,
    '',
    `Mark renewed:  ${input.renewUrl}`,
    `Acknowledge:   ${input.acknowledgeUrl}`,
    '', 'Sent by Sanad. Dates are Asia/Dubai.',
  ].join('\n');

  return { subject, html, text };
}

// ---------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Send via Resend.
 *
 * Uses fetch rather than the SDK so the cron route stays dependency-light
 * and the failure shape is explicit: this never throws, because one bad
 * address must not abort the rest of the night's reminders.
 */
export async function sendEmail(params: {
  to: string; subject: string; html: string; text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not configured' };

  const from = process.env.ALERT_FROM_EMAIL || 'Sanad <alerts@example.com>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [params.to], subject: params.subject,
        html: params.html, text: params.text,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body?.message || `Resend returned ${res.status}` };
    }
    return { ok: true, id: body?.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------
// Monthly compliance report
// ---------------------------------------------------------------------

export interface MonthlyReportEmailInput {
  recipientName: string;
  organizationName: string;
  monthLabel: string;
  entities: Array<{ name: string; compliancePercent: number; expired: number; dueIn60: number }>;
  appUrl: string;
}

export function renderMonthlyReportEmail(input: MonthlyReportEmailInput): RenderedEmail {
  const worst = Math.min(...input.entities.map((e) => e.compliancePercent), 100);
  const totalExpired = input.entities.reduce((n, e) => n + e.expired, 0);

  const subject =
    totalExpired > 0
      ? `${input.monthLabel} compliance: ${totalExpired} document${totalExpired === 1 ? '' : 's'} expired`
      : `${input.monthLabel} compliance: nothing has lapsed`;

  const tone = worst === 100 ? OK_TONE : worst >= 90 ? WARN_TONE : DANGER_TONE;

  const rows = input.entities.map((e) => `
    <tr>
      <td style="padding:7px 0;border-top:1px solid #eef2f5;font-size:14px;">${esc(e.name)}</td>
      <td style="padding:7px 0;border-top:1px solid #eef2f5;font-size:14px;text-align:right;font-weight:bold;color:${
        e.compliancePercent === 100 ? '#1c6b4a' : e.compliancePercent >= 90 ? '#8a5a12' : '#8c1d1d'
      };">${e.compliancePercent}%</td>
      <td style="padding:7px 0;border-top:1px solid #eef2f5;font-size:13px;text-align:right;color:#5a6673;">${e.expired} expired</td>
      <td style="padding:7px 0;border-top:1px solid #eef2f5;font-size:13px;text-align:right;color:#5a6673;">${e.dueIn60} due in 60d</td>
    </tr>`).join('');

  const html = `<!-- Sanad monthly report -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f8;padding:24px 0;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e2e8ee;border-radius:10px;font-family:Arial,Helvetica,sans-serif;">
    <tr><td style="padding:20px 24px 0;">
      <span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${tone.bg};color:${tone.ink};font-size:12px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;">${esc(input.monthLabel)}</span>
    </td></tr>
    <tr><td style="padding:14px 24px 0;">
      <div style="font-size:21px;font-weight:bold;color:#131a22;">Compliance report</div>
      <div style="font-size:15px;color:#5a6673;padding-top:6px;">${esc(input.organizationName)}</div>
    </td></tr>
    <tr><td style="padding:18px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
    </td></tr>
    <tr><td style="padding:18px 24px 0;font-size:13px;color:#5a6673;line-height:1.6;">
      A one-page PDF for each company is attached.
      ${totalExpired > 0
        ? `<strong style="color:#8c1d1d;">${totalExpired} document${totalExpired === 1 ? ' has' : 's have'} already expired</strong> and need attention.`
        : 'Nothing has lapsed this month.'}
    </td></tr>
    <tr><td style="padding:22px 24px 24px;">
      ${button(`${input.appUrl}/documents?status=expired`, 'Open the register', true)}
      <div style="border-top:1px solid #eef2f5;margin-top:14px;padding-top:14px;font-size:12px;color:#7b8794;">
        Sent by Sanad to ${esc(input.recipientName)}. Dates are Asia/Dubai.
      </div>
    </td></tr>
  </table>
</td></tr></table>`;

  const text = [
    subject, '',
    `${input.organizationName} — ${input.monthLabel}`, '',
    ...input.entities.map((e) => `  ${e.name}: ${e.compliancePercent}% compliant, ${e.expired} expired, ${e.dueIn60} due in 60 days`),
    '', 'A one-page PDF for each company is attached.',
    `Register: ${input.appUrl}/documents`, '',
    'Sent by Sanad. Dates are Asia/Dubai.',
  ].join('\n');

  return { subject, html, text };
}

export interface EmailAttachment { filename: string; content: string }

/** Same as sendEmail, with base64 attachments (Resend takes them inline). */
export async function sendEmailWithAttachments(params: {
  to: string[]; subject: string; html: string; text: string; attachments: EmailAttachment[];
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not configured' };
  const from = process.env.ALERT_FROM_EMAIL || 'Sanad <alerts@example.com>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: params.to, subject: params.subject,
        html: params.html, text: params.text, attachments: params.attachments,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.message || `Resend returned ${res.status}` };
    return { ok: true, id: body?.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
