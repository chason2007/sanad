import { requireSession } from '@/lib/auth';
import { fetchHolders, fetchRegister } from '@/lib/queries';
import { HoldersClient } from '@/components/holders-client';
import { canWrite } from '@/lib/types';

export const metadata = { title: 'People & assets' };

export default async function HoldersPage() {
  const session = await requireSession();
  const [holders, rows] = await Promise.all([fetchHolders(), fetchRegister()]);

  return (
    <HoldersClient
      holders={holders}
      rows={rows}
      entities={session.entities}
      canWrite={canWrite(session.profile.role)}
    />
  );
}
