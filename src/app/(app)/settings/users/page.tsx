import { requireSession } from '@/lib/auth';
import { fetchTeam } from '@/lib/queries';
import { UsersSettings } from '@/components/users-settings';

export const metadata = { title: 'People' };

export default async function UsersSettingsPage() {
  const session = await requireSession();
  const team = await fetchTeam();

  return (
    <UsersSettings
      team={team}
      currentUser={session.profile}
      isOwner={session.profile.role === 'owner'}
    />
  );
}
