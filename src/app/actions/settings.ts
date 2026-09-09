'use server';

import { revalidatePath } from 'next/cache';
import { requireSession, requireWriteAccess, requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAudit } from '@/lib/audit';
import { nullifyEmpty, requiredString } from '@/lib/utils';
import type { UserRole } from '@/lib/types';
import type { ActionResult } from '@/app/actions/documents';

const ROLES: UserRole[] = ['owner', 'admin', 'viewer'];

// ---------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------

export async function updateEntity(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();
    const supabase = createClient();

    const entityId = requiredString(formData.get('entity_id'), 'Company');
    const name = requiredString(formData.get('name'), 'Company name');

    const { error } = await supabase
      .from('entities')
      .update({
        name,
        trade_licence_number: nullifyEmpty(formData.get('trade_licence_number')),
        emirate: nullifyEmpty(formData.get('emirate')),
        escalation_user_id: nullifyEmpty(formData.get('escalation_user_id')),
      })
      .eq('id', entityId);

    if (error) return { ok: false, error: error.message };

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'entity.updated',
      targetTable: 'entities',
      targetId: entityId,
      metadata: { name },
    });

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function createEntity(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();
    const supabase = createClient();

    // Entity limit is a plan boundary, so it is checked before the insert
    // rather than left to fail on a constraint the user cannot interpret.
    const { count } = await supabase
      .from('entities').select('id', { count: 'exact', head: true });

    if ((count ?? 0) >= session.organization.entity_limit) {
      return {
        ok: false,
        error: `Your plan covers ${session.organization.entity_limit} ${
          session.organization.entity_limit === 1 ? 'company' : 'companies'
        }. Upgrade to add more.`,
      };
    }

    const name = requiredString(formData.get('name'), 'Company name');

    const { data, error } = await supabase
      .from('entities')
      .insert({
        org_id: session.organization.id,
        name,
        trade_licence_number: nullifyEmpty(formData.get('trade_licence_number')),
        emirate: nullifyEmpty(formData.get('emirate')),
        escalation_user_id: session.userId,
      })
      .select('id')
      .single();

    if (error) return { ok: false, error: error.message };

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'entity.created',
      targetTable: 'entities',
      targetId: data.id,
      metadata: { name },
    });

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------

/**
 * Invite a colleague.
 *
 * Uses the service-role client because creating an auth user is an admin
 * operation - but only after requireRole('owner') has established that the
 * caller may do it, and the profile is pinned to the caller's own org so a
 * forged org_id in the form cannot place a user elsewhere.
 */
export async function inviteUser(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireRole('owner');
    const email = requiredString(formData.get('email'), 'Email').toLowerCase();
    const fullName = nullifyEmpty(formData.get('full_name')) ?? '';
    const roleRaw = nullifyEmpty(formData.get('role')) ?? 'viewer';
    const role = (ROLES.includes(roleRaw as UserRole) ? roleRaw : 'viewer') as UserRole;

    const admin = createAdminClient();
    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/callback`;

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: fullName },
    });

    if (error) return { ok: false, error: error.message };
    if (!data.user) return { ok: false, error: 'Could not create that user.' };

    const { error: profileError } = await admin.from('profiles').insert({
      id: data.user.id,
      org_id: session.organization.id,
      full_name: fullName,
      email,
      role,
      phone_e164: nullifyEmpty(formData.get('phone_e164')),
    });

    if (profileError) {
      // Do not leave an auth user with no profile - they would sign in to
      // a dead end that no screen knows how to recover from.
      await admin.auth.admin.deleteUser(data.user.id);
      return { ok: false, error: profileError.message };
    }

    const supabase = createClient();
    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'user.invited',
      targetTable: 'profiles',
      targetId: data.user.id,
      metadata: { email, role },
    });

    revalidatePath('/settings/users');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function updateUserRole(userId: string, role: UserRole): Promise<ActionResult> {
  try {
    const session = await requireRole('owner');
    if (!ROLES.includes(role)) return { ok: false, error: 'Unknown role.' };

    if (userId === session.userId) {
      return { ok: false, error: 'You cannot change your own role.' };
    }

    const supabase = createClient();
    const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
    if (error) return { ok: false, error: error.message };

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'user.role_changed',
      targetTable: 'profiles',
      targetId: userId,
      metadata: { role },
    });

    revalidatePath('/settings/users');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function removeUser(userId: string): Promise<ActionResult> {
  try {
    const session = await requireRole('owner');
    if (userId === session.userId) {
      return { ok: false, error: 'You cannot remove yourself.' };
    }

    const supabase = createClient();
    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    if (error) return { ok: false, error: error.message };

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'user.removed',
      targetTable: 'profiles',
      targetId: userId,
    });

    revalidatePath('/settings/users');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Anyone may edit their own name, phone and notification preferences. */
export async function updateOwnProfile(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireSession();
    const supabase = createClient();

    const phone = nullifyEmpty(formData.get('phone_e164'));
    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
      return { ok: false, error: 'Enter the phone number in international format, e.g. +971501234567.' };
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: nullifyEmpty(formData.get('full_name')) ?? '',
        phone_e164: phone,
        notification_email: formData.get('notification_email') === 'on',
        notification_whatsapp: formData.get('notification_whatsapp') === 'on',
      })
      .eq('id', session.userId);

    if (error) return { ok: false, error: error.message };

    revalidatePath('/settings/users');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------
// Alert rules
// ---------------------------------------------------------------------

/**
 * Set the lead days for one document type.
 *
 * Sorted descending and de-duplicated before saving: the alert engine walks
 * these in order, and a duplicated 30 would mean two identical reminders on
 * the same day. The unique index on alerts would catch it, but sending the
 * engine a clean list is better than relying on a constraint to hide a mess.
 */
export async function updateAlertRule(
  documentTypeId: string,
  leadDays: number[],
): Promise<ActionResult> {
  try {
    const session = await requireWriteAccess();
    const supabase = createClient();

    const cleaned = Array.from(new Set(leadDays))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 365)
      .sort((a, b) => b - a);

    if (!cleaned.length) {
      return { ok: false, error: 'Keep at least one reminder, even if it is only on the day.' };
    }

    const { error } = await supabase
      .from('alert_rules')
      .upsert(
        { org_id: session.organization.id, document_type_id: documentTypeId, lead_days: cleaned },
        { onConflict: 'org_id,document_type_id' },
      );

    if (error) return { ok: false, error: error.message };

    await recordAudit(supabase, {
      orgId: session.organization.id,
      actorUserId: session.userId,
      action: 'alert_rule.updated',
      targetTable: 'alert_rules',
      targetId: documentTypeId,
      metadata: { lead_days: cleaned },
    });

    revalidatePath('/settings/alerts');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
