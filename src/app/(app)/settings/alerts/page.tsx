import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fetchDocumentTypes } from '@/lib/queries';
import { AlertsSettings } from '@/components/alerts-settings';
import { canWrite, type AlertRule } from '@/lib/types';

export const metadata = { title: 'Reminders' };

export default async function AlertsSettingsPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [documentTypes, { data: rules }] = await Promise.all([
    fetchDocumentTypes(),
    supabase.from('alert_rules').select('*'),
  ]);

  return (
    <AlertsSettings
      documentTypes={documentTypes}
      rules={(rules ?? []) as AlertRule[]}
      canWrite={canWrite(session.profile.role)}
    />
  );
}
