import { requireSession } from '@/lib/auth';
import { SettingsNav } from '@/components/settings-nav';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <SettingsNav isOwner={session.profile.role === 'owner'} />
      <div className="max-w-4xl">{children}</div>
    </div>
  );
}
