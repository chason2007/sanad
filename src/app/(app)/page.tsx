import Link from 'next/link';
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, Upload } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { fetchRegister } from '@/lib/queries';
import { dashboardRows, summarise } from '@/lib/register';
import { RegisterTable } from '@/components/register-table';
import { Button } from '@/components/ui/button';
import { canWrite } from '@/lib/types';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Dashboard' };

const HORIZON_DAYS = 90;

export default async function DashboardPage() {
  const session = await requireSession();
  const rows = await fetchRegister();

  const summary = summarise(rows);
  const upcoming = dashboardRows(rows, HORIZON_DAYS);
  const writable = canWrite(session.profile.role);
  const multiEntity = session.entities.length > 1;

  const counters = [
    {
      label: 'Expired', value: summary.expired, href: '/documents?status=expired',
      icon: AlertTriangle,
      tone: 'border-danger/30 bg-danger-soft text-danger-ink',
      hint: 'Fines may already be accruing',
    },
    {
      label: 'Due in 7 days', value: summary.dueIn7, href: '/documents?status=expiring_soon',
      icon: CalendarClock,
      tone: 'border-danger/20 bg-danger-soft/50 text-danger-ink',
      hint: 'Act this week',
    },
    {
      label: 'Due in 30 days', value: summary.dueIn30, href: '/documents?status=expiring_soon',
      icon: CalendarDays,
      tone: 'border-warn/30 bg-warn-soft text-warn-ink',
      hint: 'Includes the 7-day count',
    },
    {
      label: 'Valid', value: summary.valid, href: '/documents?status=valid',
      icon: CheckCircle2,
      tone: 'border-ok/25 bg-ok-soft text-ok-ink',
      hint: 'More than 30 days left',
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Compliance register</h1>
          <p className="text-sm text-muted-foreground">
            {summary.total} tracked {summary.total === 1 ? 'document' : 'documents'} across{' '}
            {session.entities.length} {session.entities.length === 1 ? 'entity' : 'entities'}.
          </p>
        </div>
        {writable && (
          <Button asChild size="sm">
            <Link href="/upload"><Upload />Upload documents</Link>
          </Button>
        )}
      </div>

      {/* Four counters, above the fold, no charts. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counters.map((counter) => {
          const Icon = counter.icon;
          return (
            <Link
              key={counter.label}
              href={counter.href}
              className={cn(
                'rounded-lg border p-3 transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                counter.value > 0 ? counter.tone : 'bg-card',
              )}
            >
              <span className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide">{counter.label}</span>
                <Icon className="h-4 w-4 opacity-70" />
              </span>
              <span className="mt-1.5 block text-3xl font-semibold tabular-nums leading-none">
                {counter.value}
              </span>
              <span className="mt-1.5 block text-2xs opacity-75">{counter.hint}</span>
            </Link>
          );
        })}
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Expiring in the next {HORIZON_DAYS} days
          </h2>
          <Link href="/documents" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            See the full register
          </Link>
        </div>

        <RegisterTable
          rows={upcoming}
          showEntity={multiEntity}
          canWrite={writable}
          emptyMessage={
            summary.total === 0
              ? 'No documents yet. Upload your first one and Sanad will start watching the dates.'
              : `Nothing expires in the next ${HORIZON_DAYS} days. That is the whole idea.`
          }
        />
      </div>
    </div>
  );
}
