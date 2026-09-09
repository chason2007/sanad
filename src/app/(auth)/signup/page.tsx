'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignupPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const companyName = String(form.get('company_name') || '').trim();
    const fullName = String(form.get('full_name') || '').trim();
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');

    if (password.length < 8) {
      toast.error('Use at least 8 characters for your password.');
      return;
    }

    setBusy(true);
    const supabase = createClient();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }

    // No session means email confirmation is switched on for this project.
    // The org is created on first sign-in instead.
    if (!data.session) {
      setBusy(false);
      toast.success('Check your email to confirm your address, then sign in.');
      router.push('/login');
      return;
    }

    // One transaction: organization + first entity + owner profile.
    const { error: rpcError } = await supabase.rpc('signup_org', {
      p_company_name: companyName,
      p_full_name: fullName,
      p_entity_name: companyName,
      p_trade_licence_number: null,
      p_emirate: null,
      p_phone_e164: null,
    });

    setBusy(false);

    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }

    // Refresh the token so the new org_id claim is present.
    await supabase.auth.refreshSession();
    router.push('/onboarding');
    router.refresh();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Start your trial</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        14 days, no card. Bring your spreadsheet.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="company_name">Company name</Label>
          <Input id="company_name" name="company_name" required placeholder="Al Noor Contracting LLC" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="full_name">Your name</Label>
          <Input id="full_name" name="full_name" required autoComplete="name" placeholder="Fatima Al Marzooqi" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@company.ae" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>

      <p className="mt-8 text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
