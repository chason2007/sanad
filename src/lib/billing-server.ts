import { createClient } from '@/lib/supabase/server';
import { checkDocumentLimit, checkEntityLimit, entitlementsFor, type LimitCheck } from '@/lib/billing';
import type { SessionContext } from '@/lib/types';

/**
 * Server-side limit guards.
 *
 * Counts are read at the moment of the check rather than cached, because
 * the number the user is about to exceed has to be the real one. Two admins
 * adding documents at once can still race past the limit by one; that is
 * accepted deliberately - hard-blocking with a database constraint would
 * mean a compliance document is rejected outright, and being one over is a
 * far smaller problem than a document nobody recorded.
 */

export async function documentCount(): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .not('status', 'in', '("archived")');
  return count ?? 0;
}

export async function entityCount(): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase.from('entities').select('id', { count: 'exact', head: true });
  return count ?? 0;
}

export async function checkCanAddDocument(session: SessionContext): Promise<LimitCheck> {
  return checkDocumentLimit(session.organization, await documentCount());
}

export async function checkCanAddEntity(session: SessionContext): Promise<LimitCheck> {
  return checkEntityLimit(session.organization, await entityCount());
}

export const entitlements = (session: SessionContext) => entitlementsFor(session.organization);
