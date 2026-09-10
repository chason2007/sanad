import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { dubaiToday, MONTH_LABEL } from '@/lib/dates';
import { renderEntityReport, computeStats } from '@/lib/reports/monthly-report';
import { renderMonthlyReportEmail, sendEmailWithAttachments } from '@/lib/alerts/email';
import { entitlementsFor } from '@/lib/billing';
import { recordAudit } from '@/lib/audit';
import type { Entity, Organization, Profile, RegisterRow } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SOFT_DEADLINE_MS = 50_000;

/**
 * POST /api/cron/monthly-report - the 1st of the month, 03:00 UTC (07:00 GST).
 *
 * One page per entity, emailed to every owner and admin in the org as PDF
 * attachments, with a summary table in the body so the numbers are visible
 * without opening anything.
 *
 * Delinquent organisations do NOT get a report, even though they still get
 * alerts. That is the degradation order working as intended: the monthly
 * report is a management convenience, so it stops early; the reminders are
 * the safety mechanism, so they run for the full 30-day grace.
 *
 * ?dry_run=true reports what it would send, renders nothing, mails nothing.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if ((auth.startsWith('Bearer ') ? auth.slice(7) : '') !== secret) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dry_run') === 'true';
  const now = new Date();
  const today = dubaiToday(now);
  const monthLabel = MONTH_LABEL(today);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const [orgsRes, entitiesRes, profilesRes, documentsRes] = await Promise.all([
    supabase.from('organizations').select('*'),
    supabase.from('entities').select('*'),
    supabase.from('profiles').select('*'),
    supabase.from('document_register').select('*').limit(10_000),
  ]);

  const firstError = [orgsRes, entitiesRes, profilesRes, documentsRes].find((r) => r.error)?.error;
  if (firstError) {
    return NextResponse.json({ error: `Could not load data: ${firstError.message}` }, { status: 500 });
  }

  const organizations = (orgsRes.data ?? []) as Organization[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const profiles = (profilesRes.data ?? []) as Profile[];
  const documents = (documentsRes.data ?? []) as RegisterRow[];

  const sent: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];
  const preview: Array<Record<string, unknown>> = [];

  for (const org of organizations) {
    if (Date.now() - started > SOFT_DEADLINE_MS) {
      skipped.push({ org: org.name, reason: 'ran out of time; next run will catch it' });
      continue;
    }

    const ent = entitlementsFor(org, now);
    if (ent.state !== 'healthy') {
      skipped.push({ org: org.name, reason: `billing ${ent.state}` });
      continue;
    }

    // Owners and admins. Viewers do not get the management report.
    const recipients = profiles.filter(
      (p) => p.org_id === org.id && (p.role === 'owner' || p.role === 'admin') && p.notification_email,
    );
    if (!recipients.length) {
      skipped.push({ org: org.name, reason: 'no owner or admin with email enabled' });
      continue;
    }

    const orgEntities = entities.filter((e) => e.org_id === org.id);
    if (!orgEntities.length) {
      skipped.push({ org: org.name, reason: 'no companies' });
      continue;
    }

    const summaries = orgEntities.map((entity) => {
      const rows = documents.filter((d) => d.entity_id === entity.id);
      const stats = computeStats(rows, now);
      return { entity, rows, stats };
    });

    if (dryRun) {
      preview.push({
        org: org.name,
        to: recipients.map((r) => r.email),
        entities: summaries.map((s) => ({
          name: s.entity.name,
          compliance: `${s.stats.compliancePercent}%`,
          expired: s.stats.expired,
          due_in_60: s.stats.dueIn60,
          tracked: s.stats.total,
        })),
      });
      continue;
    }

    try {
      const attachments = await Promise.all(
        summaries.map(async (s) => ({
          filename: `${s.entity.name.replace(/[^\w\-]+/g, '-').slice(0, 60)}-${today}.pdf`,
          content: (
            await renderEntityReport({
              organizationName: org.name,
              entityName: s.entity.name,
              rows: s.rows,
              now,
            })
          ).toString('base64'),
        })),
      );

      const email = renderMonthlyReportEmail({
        recipientName: recipients.length === 1 ? (recipients[0].full_name || recipients[0].email) : 'the team',
        organizationName: org.name,
        monthLabel,
        entities: summaries.map((s) => ({
          name: s.entity.name,
          compliancePercent: s.stats.compliancePercent,
          expired: s.stats.expired,
          dueIn60: s.stats.dueIn60,
        })),
        appUrl,
      });

      const result = await sendEmailWithAttachments({
        to: recipients.map((r) => r.email),
        ...email,
        attachments,
      });

      if (result.ok) {
        sent.push({ org: org.name, to: recipients.map((r) => r.email), reports: attachments.length });
        await recordAudit(supabase, {
          orgId: org.id,
          actorUserId: null,
          action: 'report.generated',
          metadata: {
            period: monthLabel, entities: attachments.length,
            recipients: recipients.map((r) => r.email), channel: 'monthly_email',
          },
        });
      } else {
        failed.push({ org: org.name, error: result.error });
      }
    } catch (err) {
      // One organisation's report failing must not stop the rest of the run.
      failed.push({ org: org.name, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    period: monthLabel,
    dubai_today: today,
    organizations: organizations.length,
    ...(dryRun ? { would_send: preview } : { sent, failed }),
    skipped,
    email_configured: Boolean(process.env.RESEND_API_KEY),
    took_ms: Date.now() - started,
  });
}

/** Vercel Cron invokes with GET; the bearer token is the gate either way. */
export async function GET(request: NextRequest) {
  return POST(request);
}
