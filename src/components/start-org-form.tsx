'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Completes signup for a confirmed user who has no organisation yet.
 *
 * Deliberately the same signup_org RPC the signup page calls, rather than a
 * second path that could drift: one transaction, one set of guards, one
 * thing to keep correct.
 */
export function StartOrgForm({
  defaultFullName, email,
}: { defaultFullName: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const companyName = String(form.get('company_name') || '').trim();
    const fullName = String(form.get('full_name') || '').trim();

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('signup_org', {
      p_company_name: companyName,
      p_full_name: fullName,
      p_entity_name: companyName,
      p_trade_licence_number: null,
      p_emirate: null,
      p_phone_e164: null,
    });

    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }

    // Refresh the token so the new org_id claim is present.
    await supabase.auth.refreshSession();
    router.push('/onboarding');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="company_name">Company name</Label>
        <Input id="company_name" name="company_name" required autoFocus placeholder="Al Noor Contracting LLC" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="full_name">Your name</Label>
        <Input id="full_name" name="full_name" required defaultValue={defaultFullName} placeholder="Fatima Al Marzooqi" />
      </div>
      <p className="text-xs text-muted-foreground">Signed in as {email}</p>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        Create my register
      </Button>
    </form>
  );
}
