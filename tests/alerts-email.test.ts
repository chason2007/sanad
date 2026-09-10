import { describe, it, expect } from 'vitest';
import { alertSubject, renderAlertEmail, renderEscalationEmail } from '@/lib/alerts/email';
import type { RenewalChecklist } from '@/lib/types';

const checklist: RenewalChecklist = {
  steps: [
    { title: 'Book the medical fitness test', detail: 'Results take two to five days.', where: 'DHA centre' },
    { title: 'Renew medical insurance', detail: 'Needed before stamping.', where: 'Broker' },
  ],
  documents_required: ['Passport', 'Existing visa copy'],
};

const base = {
  recipientName: 'Fatima Al Marzooqi',
  documentTypeLabel: 'Emirates ID',
  holderName: 'Rajesh Kumar',
  entityName: 'Al Noor Contracting LLC',
  documentNumber: '784-1990-1234567-1',
  expiryDate: '2026-09-17',
  daysRemaining: 7,
  checklist,
  typicalLeadTimeDays: 14,
  acknowledgeUrl: 'https://sanad.example/a/ack-token',
  renewUrl: 'https://sanad.example/a/renew-token',
};

describe('subject line carries the urgency', () => {
  it('matches the format in the spec', () => {
    expect(alertSubject(7, 'Emirates ID', 'Rajesh Kumar'))
      .toBe('Expiring in 7 days: Emirates ID — Rajesh Kumar');
  });

  it('escalates the wording as the deadline closes', () => {
    expect(alertSubject(30, 'Trade Licence', null)).toBe('Expiring in 30 days: Trade Licence');
    expect(alertSubject(1, 'Emirates ID', 'Rajesh Kumar')).toBe('Expires TOMORROW: Emirates ID — Rajesh Kumar');
    expect(alertSubject(0, 'Emirates ID', 'Rajesh Kumar')).toBe('Expires TODAY: Emirates ID — Rajesh Kumar');
  });

  it('says so plainly once it has lapsed', () => {
    expect(alertSubject(-1, 'Labour Card', 'Priya Nair')).toBe('EXPIRED 1 day ago: Labour Card — Priya Nair');
    expect(alertSubject(-8, 'Labour Card', 'Priya Nair')).toBe('EXPIRED 8 days ago: Labour Card — Priya Nair');
  });

  it('omits the dash when there is no holder', () => {
    expect(alertSubject(7, 'Trade Licence', null)).toBe('Expiring in 7 days: Trade Licence');
  });
});

describe('alert email body', () => {
  const email = renderAlertEmail(base);

  it('leads with the document, holder and expiry date', () => {
    expect(email.html).toContain('Emirates ID');
    expect(email.html).toContain('Rajesh Kumar');
    expect(email.html).toContain('17 Sep 2026');
    expect(email.html).toContain('Al Noor Contracting LLC');
  });

  it('carries both action buttons as real links', () => {
    expect(email.html).toContain('https://sanad.example/a/renew-token');
    expect(email.html).toContain('https://sanad.example/a/ack-token');
    expect(email.html).toContain('Mark renewed');
    expect(email.html).toContain('Acknowledge');
  });

  it('includes the renewal checklist steps', () => {
    expect(email.html).toContain('Book the medical fitness test');
    expect(email.html).toContain('Renew medical insurance');
    expect(email.html).toContain('Passport');
  });

  it('uses table-based buttons so Outlook renders them', () => {
    // Outlook on Windows uses Word to render HTML and drops most CSS.
    expect(email.html).toMatch(/<table role="presentation"[^>]*>[\s\S]*?bgcolor=/);
  });

  it('ships a plain-text alternative with both links', () => {
    expect(email.text).toContain('https://sanad.example/a/renew-token');
    expect(email.text).toContain('https://sanad.example/a/ack-token');
    expect(email.text).toContain('Emirates ID');
    expect(email.text).not.toContain('<table');
  });

  it('states the timezone, because the whole product hinges on it', () => {
    expect(email.html).toContain('Asia/Dubai');
    expect(email.text).toContain('Asia/Dubai');
  });

  it('renders without a checklist', () => {
    const bare = renderAlertEmail({ ...base, checklist: null, typicalLeadTimeDays: null });
    expect(bare.html).toContain('Emirates ID');
    expect(bare.html).not.toContain('How to renew');
  });

  it('renders for a company document with no holder', () => {
    const company = renderAlertEmail({ ...base, holderName: null, documentTypeLabel: 'Trade Licence' });
    expect(company.subject).toBe('Expiring in 7 days: Trade Licence');
    expect(company.html).toContain('Trade Licence');
  });
});

describe('escaping', () => {
  it('neutralises HTML in a holder name', () => {
    // Holder names arrive from uploaded documents via the extraction model.
    // Anything from there is untrusted input on its way into an email body.
    const nasty = renderAlertEmail({
      ...base,
      holderName: '<script>alert(1)</script>',
      entityName: 'Acme " onmouseover="evil()',
    });
    expect(nasty.html).not.toContain('<script>');
    expect(nasty.html).toContain('&lt;script&gt;');
    expect(nasty.html).not.toContain('onmouseover="evil()');
    expect(nasty.html).toContain('&quot;');
  });

  it('escapes a hostile checklist step', () => {
    const nasty = renderAlertEmail({
      ...base,
      checklist: {
        steps: [{ title: '<img src=x onerror=alert(1)>', detail: 'x', where: 'y' }],
        documents_required: ['<b>bold</b>'],
      },
    });
    expect(nasty.html).not.toContain('<img src=x');
    expect(nasty.html).not.toContain('<b>bold</b>');
  });
});

describe('escalation email', () => {
  const email = renderEscalationEmail({
    recipientName: 'Owner Boss',
    originalRecipientName: 'Fatima Al Marzooqi',
    documentTypeLabel: 'Emirates ID',
    holderName: 'Rajesh Kumar',
    entityName: 'Al Noor Contracting LLC',
    expiryDate: '2026-09-17',
    daysRemaining: 5,
    hoursSinceSent: 52,
    acknowledgeUrl: 'https://sanad.example/a/ack',
    renewUrl: 'https://sanad.example/a/renew',
  });

  it('says in the subject that nobody acknowledged it', () => {
    expect(email.subject).toBe('Not acknowledged: Emirates ID — Rajesh Kumar (in 5 days)');
  });

  it('names who was asked and how long ago', () => {
    expect(email.html).toContain('Fatima Al Marzooqi');
    expect(email.html).toContain('52 hours ago');
    expect(email.text).toContain('52 hours ago');
  });

  it('gives the escalation contact the same two actions', () => {
    expect(email.html).toContain('https://sanad.example/a/renew');
    expect(email.html).toContain('https://sanad.example/a/ack');
  });
});
