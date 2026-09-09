import { createClient } from '@/lib/supabase/server';
import type { DocumentType, Entity, Holder, Profile, RegisterRow } from '@/lib/types';

/**
 * All register reads go through here.
 *
 * None of these functions filter by org_id. That is deliberate: RLS already
 * scopes every row to the caller's tenant, and adding a redundant WHERE
 * clause in application code invites the habit of trusting application code
 * for isolation. The database is the boundary.
 */

export async function fetchRegister(): Promise<RegisterRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('document_register')
    .select('*')
    .order('expiry_date', { ascending: true });

  if (error) throw new Error(`Could not load the register: ${error.message}`);
  return (data ?? []) as RegisterRow[];
}

export async function fetchRegisterRow(id: string): Promise<RegisterRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('document_register')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as RegisterRow) ?? null;
}

export async function fetchDocumentTypes(): Promise<DocumentType[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('document_types')
    .select('*')
    .order('label');

  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentType[];
}

export async function fetchHolders(): Promise<Holder[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('holders')
    .select('*')
    .order('name');

  if (error) throw new Error(error.message);
  return (data ?? []) as Holder[];
}

export async function fetchEntities(): Promise<Entity[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('entities').select('*').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Entity[];
}

export async function fetchTeam(): Promise<Profile[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('profiles').select('*').order('full_name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

/**
 * Walk `superseded_by_id` backwards and forwards to assemble the full
 * renewal chain for a document, oldest first. This is the history an
 * auditor asks for: what did this licence look like three renewals ago.
 */
export async function fetchRenewalChain(documentId: string): Promise<RegisterRow[]> {
  const rows = await fetchRegister();
  const byId = new Map(rows.map((r) => [r.id, r]));

  const start = byId.get(documentId);
  if (!start) return [];

  const backwards: RegisterRow[] = [];
  const seen = new Set<string>([documentId]);

  // Predecessors: the row whose superseded_by_id points at us.
  let cursor = start;
  for (;;) {
    const previous = rows.find((r) => r.superseded_by_id === cursor.id && !seen.has(r.id));
    if (!previous) break;
    seen.add(previous.id);
    backwards.unshift(previous);
    cursor = previous;
  }

  const forwards: RegisterRow[] = [];
  cursor = start;
  while (cursor.superseded_by_id) {
    const next = byId.get(cursor.superseded_by_id);
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    forwards.push(next);
    cursor = next;
  }

  return [...backwards, start, ...forwards];
}

export async function fetchAlertsForDocument(documentId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('alerts')
    .select('*, recipient:profiles!alerts_recipient_user_id_fkey(full_name, email)')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}
