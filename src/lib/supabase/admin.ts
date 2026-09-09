import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY.
 *
 * Legitimate uses are narrow: the nightly alert job (which has no user
 * session), Stripe webhooks (same), and reading a file for extraction.
 * Anything reachable from a browser request must use the session client
 * instead, or the tenant boundary stops meaning anything.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
