import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Entity, Organization, Profile, SessionContext, UserRole } from '@/lib/types';
import { canWrite } from '@/lib/types';

/**
 * The org context for the current request.
 *
 * `cache` dedupes this across a render pass, so a layout and five server
 * components can each ask for the session without five round trips.
 *
 * Returns null rather than redirecting so callers can decide - the login
 * page needs to ask "is anyone signed in?" without being bounced.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = createClient();

  // getUser() revalidates the token with the auth server. getSession() reads
  // it from a cookie and trusts it, which is not good enough for authz.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  // Authenticated but no profile: signup was interrupted between creating
  // the auth user and running signup_org.
  if (!profile) return null;

  const [{ data: organization }, { data: entities }] = await Promise.all([
    supabase.from('organizations').select('*').eq('id', profile.org_id).maybeSingle(),
    supabase.from('entities').select('*').order('name'),
  ]);

  if (!organization) return null;

  return {
    userId: user.id,
    profile: profile as Profile,
    organization: organization as Organization,
    entities: (entities ?? []) as Entity[],
  };
});

/** For pages behind the app shell. Sends anonymous users to login. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect('/login');
  return session;
}

/** Guard for any mutating server action. Viewers are read-only. */
export async function requireWriteAccess(): Promise<SessionContext> {
  const session = await requireSession();
  if (!canWrite(session.profile.role)) {
    throw new Error('Your account is read-only. Ask an admin to make this change.');
  }
  return session;
}

export async function requireRole(...roles: UserRole[]): Promise<SessionContext> {
  const session = await requireSession();
  if (!roles.includes(session.profile.role)) {
    throw new Error('You do not have permission to do that.');
  }
  return session;
}
