import { requireSession } from '@/lib/auth';
import { fetchRegister } from '@/lib/queries';
import { summarise } from '@/lib/register';
import { ReportsClient } from '@/components/reports-client';
import { dubaiToday, MONTH_LABEL } from '@/lib/dates';

export const metadata = { title: 'Reports' };

export default async function ReportsPage() {
  const session = await requireSession();
  const rows = await fetchRegister();
  const summary = summarise(rows);

  return (
    <ReportsClient
      entities={session.entities}
      summary={summary}
      monthLabel={MONTH_LABEL(dubaiToday())}
    />
  );
}
