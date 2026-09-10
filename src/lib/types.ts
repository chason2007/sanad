import type { IsoDate } from './dates';

export type OrgPlan = 'starter' | 'growth' | 'multi_entity';
export type OrgStatus = 'trialing' | 'active' | 'past_due' | 'cancelled';
export type UserRole = 'owner' | 'admin' | 'viewer';
export type HolderType = 'employee' | 'vehicle' | 'entity' | 'asset' | 'property';
export type DocumentStatus = 'valid' | 'expiring_soon' | 'expired' | 'renewed' | 'archived';
export type AlertChannel = 'email' | 'whatsapp';
export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced';
export type ExtractionStatus = 'pending' | 'succeeded' | 'failed' | 'needs_review';

export const HOLDER_TYPES: HolderType[] = ['employee', 'vehicle', 'entity', 'asset', 'property'];

export const HOLDER_TYPE_LABELS: Record<HolderType, string> = {
  employee: 'Employee',
  vehicle: 'Vehicle',
  entity: 'Company',
  asset: 'Asset',
  property: 'Property',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  owner: 'Full access, plus billing and user management.',
  admin: 'Can add, edit and renew documents. No billing.',
  viewer: 'Read-only. Cannot download files.',
};

export interface Organization {
  id: string;
  name: string;
  plan: OrgPlan;
  status: OrgStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  document_limit: number;
  entity_limit: number;
  trial_ends_at: string | null;
  /** When the org first went past_due/cancelled. Anchors the 30-day grace. */
  delinquent_since: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  org_id: string;
  full_name: string;
  email: string;
  phone_e164: string | null;
  role: UserRole;
  notification_email: boolean;
  notification_whatsapp: boolean;
  created_at: string;
  updated_at: string;
}

export interface Entity {
  id: string;
  org_id: string;
  name: string;
  trade_licence_number: string | null;
  emirate: string | null;
  escalation_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Holder {
  id: string;
  entity_id: string;
  holder_type: HolderType;
  name: string;
  identifier: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RenewalChecklistStep {
  title: string;
  detail: string;
  where: string;
}

export interface RenewalChecklist {
  steps: RenewalChecklistStep[];
  documents_required: string[];
}

export interface DocumentType {
  id: string;
  org_id: string | null;
  code: string;
  label: string;
  applies_to: HolderType;
  default_lead_days: number[];
  renewal_checklist: RenewalChecklist;
  typical_lead_time_days: number | null;
  typical_cost_aed: number | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  entity_id: string;
  holder_id: string | null;
  document_type_id: string;
  document_number: string | null;
  issue_date: IsoDate | null;
  expiry_date: IsoDate;
  file_path: string | null;
  responsible_user_id: string | null;
  status: DocumentStatus;
  notes: string | null;
  superseded_by_id: string | null;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
}

/** A row of the `document_register` view: the shape every list screen uses. */
export interface RegisterRow extends DocumentRow {
  org_id: string;
  entity_name: string;
  holder_name: string | null;
  holder_type: HolderType | null;
  holder_identifier: string | null;
  document_type_code: string;
  document_type_label: string;
  responsible_name: string | null;
  responsible_email: string | null;
  days_remaining: number;
  computed_status: DocumentStatus;
}

export interface AlertRule {
  id: string;
  org_id: string;
  document_type_id: string;
  lead_days: number[];
  created_at: string;
  updated_at: string;
}

export interface Alert {
  id: string;
  document_id: string;
  lead_day: number;
  channel: AlertChannel;
  recipient_user_id: string;
  sent_at: string | null;
  delivery_status: DeliveryStatus;
  provider_message_id: string | null;
  error: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractionJob {
  id: string;
  document_id: string;
  status: ExtractionStatus;
  raw_response: unknown;
  confidence: number | null;
  model: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  org_id: string;
  actor_user_id: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

/** The signed-in user plus the org context every server component needs. */
export interface SessionContext {
  userId: string;
  profile: Profile;
  organization: Organization;
  entities: Entity[];
}

export const canWrite = (role: UserRole) => role === 'owner' || role === 'admin';
export const canDownloadFiles = (role: UserRole) => role === 'owner' || role === 'admin';
export const canManageBilling = (role: UserRole) => role === 'owner';
export const canManageUsers = (role: UserRole) => role === 'owner';
