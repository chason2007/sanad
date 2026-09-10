import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Brand } from '@/components/brand';
import { StartOrgForm } from '@/components/start-org-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Finish setting up' };

/**
 * The landing spot for someone who is signed in but has no organisation.
 *
 * This happens more often than it looks: with email confirmation switched
 * on, signup creates the auth user and then hands control to an email, so
 * `signup_org` has not run when they click the link. It also catches a
 * signup interrupted between the two steps.
 *
 * Before this page existed, the auth callback pointed here and got a 404,
 * and `requireSession` sent these users to /login - where the middleware
 * saw a valid session and sent them straight back. An infinite bounce, for
 * the one user who has done nothing wrong.
 */
export default async function StartOrgPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles').select('id').eq('id', user.id).maybeSingle();

  // Already set up: nothing to finish.
  if (profile) redirect('/');

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Brand className="mb-8" />
      <h1 className="text-2xl font-semibold tracking-tight">One more step</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Your email is confirmed. Tell us the company name and your register is
        ready.
      </p>
      <StartOrgForm
        defaultFullName={(user.user_metadata?.full_name as string) ?? ''}
        email={user.email ?? ''}
      />
    </div>
  );
}
