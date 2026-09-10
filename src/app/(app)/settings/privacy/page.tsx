import { requireSession } from '@/lib/auth';
import { describeErasure } from '@/app/actions/privacy';
import { PrivacySettings } from '@/components/privacy-settings';

export const metadata = { title: 'Data & privacy' };

export default async function PrivacySettingsPage() {
  const session = await requireSession();
  const counts = await describeErasure();

  return (
    <PrivacySettings
      organization={session.organization}
      isOwner={session.profile.role === 'owner'}
      counts={counts}
    />
  );
}
