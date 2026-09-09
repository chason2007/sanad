-- =====================================================================
-- Sanad - core schema
-- Timezone rule: every "today" in this database is Asia/Dubai, never the
-- server local time. Use dubai_today() and nothing else.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------
create type org_plan          as enum ('starter', 'growth', 'multi_entity');
create type org_status        as enum ('trialing', 'active', 'past_due', 'cancelled');
create type user_role         as enum ('owner', 'admin', 'viewer');
create type holder_type       as enum ('employee', 'vehicle', 'entity', 'asset', 'property');
create type document_status   as enum ('valid', 'expiring_soon', 'expired', 'renewed', 'archived');
create type alert_channel     as enum ('email', 'whatsapp');
create type delivery_status   as enum ('queued', 'sent', 'delivered', 'failed', 'bounced');
create type extraction_status as enum ('pending', 'succeeded', 'failed', 'needs_review');

-- ---------- helpers ----------

-- The single source of "today". Everything date-shaped derives from this.
create or replace function public.dubai_today()
returns date
language sql
stable
as $fn$ select (now() at time zone 'Asia/Dubai')::date $fn$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- ---------- organizations ----------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  plan org_plan not null default 'starter',
  status org_status not null default 'trialing',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  document_limit int not null default 100 check (document_limit >= 0),
  entity_limit int not null default 1 check (entity_limit >= 0),
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- profiles (extends auth.users) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  -- E.164 is the only phone format WhatsApp will accept.
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9]\d{6,14}$'),
  role user_role not null default 'viewer',
  notification_email boolean not null default true,
  notification_whatsapp boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_org_idx on public.profiles(org_id);

-- ---------- entities ----------
create table public.entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  trade_licence_number text,
  emirate text,
  -- Who to chase when an alert goes unacknowledged.
  escalation_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index entities_org_idx on public.entities(org_id);

-- ---------- holders ----------
-- Deliberately polymorphic: customers invent categories we did not plan for.
create table public.holders (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  holder_type holder_type not null,
  name text not null check (length(trim(name)) > 0),
  identifier text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index holders_entity_idx on public.holders(entity_id);
create index holders_type_idx on public.holders(entity_id, holder_type);

-- ---------- document_types ----------
-- org_id null = global seed data, shared by every tenant.
create table public.document_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  code text not null,
  label text not null,
  applies_to holder_type not null,
  default_lead_days int[] not null default '{90,60,30,7,0}',
  renewal_checklist jsonb not null default '{"steps": [], "documents_required": []}'::jsonb,
  typical_lead_time_days int,
  typical_cost_aed numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One code per org, plus one global code. Two partial indexes are needed
-- because `unique (org_id, code)` treats every NULL org_id as distinct.
create unique index document_types_global_code_idx
  on public.document_types(code) where org_id is null;
create unique index document_types_org_code_idx
  on public.document_types(org_id, code) where org_id is not null;

-- ---------- documents ----------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  holder_id uuid references public.holders(id) on delete set null,
  document_type_id uuid not null references public.document_types(id) on delete restrict,
  document_number text,
  issue_date date,
  expiry_date date not null,
  file_path text,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  status document_status not null default 'valid',
  notes text,
  -- A renewal inserts a NEW row and points the old row at it, so the
  -- history chain is never destroyed by an edit.
  superseded_by_id uuid references public.documents(id) on delete set null,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_dates_ordered check (issue_date is null or issue_date <= expiry_date),
  constraint documents_no_self_supersede check (superseded_by_id is null or superseded_by_id <> id)
);
create index documents_entity_idx on public.documents(entity_id);
create index documents_holder_idx on public.documents(holder_id);
create index documents_expiry_idx on public.documents(expiry_date);
create index documents_status_idx on public.documents(status);
create index documents_responsible_idx on public.documents(responsible_user_id);
create index documents_type_idx on public.documents(document_type_id);
create unique index documents_superseded_by_uniq on public.documents(superseded_by_id)
  where superseded_by_id is not null;

-- ---------- alert_rules ----------
create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  document_type_id uuid not null references public.document_types(id) on delete cascade,
  lead_days int[] not null default '{90,60,30,7,0}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, document_type_id)
);

-- ---------- alerts (the send log) ----------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  lead_day int not null,
  channel alert_channel not null,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  sent_at timestamptz,
  delivery_status delivery_status not null default 'queued',
  provider_message_id text,
  error text,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- THE constraint that makes this product trustworthy. A retry, a double
-- cron run, or two overlapping deploys can never send the same person the
-- same reminder for the same document twice.
create unique index alerts_idempotency_idx
  on public.alerts(document_id, lead_day, channel, recipient_user_id);
create index alerts_document_idx on public.alerts(document_id);
create index alerts_unacked_idx on public.alerts(sent_at) where acknowledged_at is null;

-- ---------- extraction_jobs ----------
create table public.extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  status extraction_status not null default 'pending',
  raw_response jsonb,
  confidence numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  model text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index extraction_jobs_document_idx on public.extraction_jobs(document_id);

-- ---------- audit_log ----------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log(org_id, created_at desc);

-- ---------- updated_at triggers ----------
do $mig$
declare t text;
begin
  foreach t in array array[
    'organizations','profiles','entities','holders','document_types',
    'documents','alert_rules','alerts','extraction_jobs','audit_log'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t, t);
  end loop;
end $mig$;
