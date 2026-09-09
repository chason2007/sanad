import { requireSession } from '@/lib/auth';
import { fetchTeam } from '@/lib/queries';
import { EntitiesSettings } from '@/components/entities-settings';
import { canWrite } from '@/lib/types';

export const metadata = { title: 'Companies' };

export default async function EntitiesSettingsPage() {
  const session = await requireSession();
  const team = await fetchTeam();

  return (
    <EntitiesSettings
      entities={session.entities}
      team={team}
      organization={session.organization}
      canWrite={canWrite(session.profile.role)}
    />
  );
}
