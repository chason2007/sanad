import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { BillingSettings } from '@/components/billing-settings';
import { canManageBilling } from '@/lib/types';

export const metadata = { title: 'Billing' };

export default async function BillingSettingsPage() {
  const session = await requireSession();
  if (!canManageBilling(session.profile.role)) redirect('/settings/entities');

  const supabase = createClient();
  const [{ count: documentCount }, { count: entityCount }] = await Promise.all([
    supabase.from('documents').select('id', { count: 'exact', head: true }),
    supabase.from('entities').select('id', { count: 'exact', head: true }),
  ]);

  return (
    <BillingSettings
      organization={session.organization}
      documentCount={documentCount ?? 0}
      entityCount={entityCount ?? 0}
    />
  );
}
