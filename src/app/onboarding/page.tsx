import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fetchTeam } from '@/lib/queries';
import { OnboardingClient } from '@/components/onboarding-client';

export const metadata = { title: 'Set up' };

/**
 * Resumable by construction: the step is derived from what actually exists
 * in the database, not from a stored wizard cursor that can drift out of
 * step with reality. Someone who closes the tab after adding holders comes
 * back to step 3, because they have holders.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { step?: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const entity = session.entities[0];
  if (!entity) redirect('/settings/entities');

  const [team, holders, documents] = await Promise.all([
    fetchTeam(),
    supabase.from('holders').select('id', { count: 'exact', head: true }),
    supabase.from('documents').select('id', { count: 'exact', head: true }),
  ]);

  const holderCount = holders.count ?? 0;
  const documentCount = documents.count ?? 0;

  const derived = !entity.trade_licence_number ? 1 : holderCount === 0 ? 2 : 3;
  const requested = Number(searchParams.step);
  const initialStep = requested >= 1 && requested <= 3 ? requested : derived;

  return (
    <div className="min-h-screen px-4">
      <OnboardingClient
        entity={entity}
        team={team}
        holderCount={holderCount}
        documentCount={documentCount}
        initialStep={initialStep}
      />
    </div>
  );
}
