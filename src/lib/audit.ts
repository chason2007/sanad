import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '@/lib/privacy';

export type AuditAction =
  | 'org.created'
  | 'document.created'
  | 'document.updated'
  | 'document.deleted'
  | 'document.renewed'
  | 'document.archived'
  | 'document.bulk_reassigned'
  | 'document.file_downloaded'
  | 'holder.created'
  | 'holder.updated'
  | 'holder.deleted'
  | 'entity.created'
  | 'entity.updated'
  | 'user.invited'
  | 'user.role_changed'
  | 'user.removed'
  | 'alert.acknowledged'
  | 'alert_rule.updated'
  | 'report.generated'
  | 'extraction.completed';

/** Best-effort client IP, honouring the proxy headers Vercel sets. */
function clientIp(): string | null {
  try {
    const h = headers();
    const forwarded = h.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
    return h.get('x-real-ip');
  } catch {
    return null;
  }
}

/**
 * Append to the audit log.
 *
 * Never throws. An audit write failing must not roll back the user's actual
 * work - we would rather lose a log line than lose a renewed document. The
 * failure is surfaced to the server logs instead.
 */
export async function recordAudit(
  supabase: SupabaseClient,
  params: {
    orgId: string;
    actorUserId: string | null;
    action: AuditAction;
    targetTable?: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { error } = await supabase.from('audit_log').insert({
      org_id: params.orgId,
      actor_user_id: params.actorUserId,
      action: params.action,
      target_table: params.targetTable ?? null,
      target_id: params.targetId ?? null,
      metadata: params.metadata ?? {},
      ip: clientIp(),
    });
    if (error) log.error('audit', `insert failed for ${params.action}`, { error: error.message });
  } catch (err) {
    log.error('audit', `insert threw for ${params.action}`, err);
  }
}
