-- =====================================================================
-- Billing grace period
--
-- When a card fails we do NOT stop sending compliance alerts. A lapsed
-- visa costs the customer AED 100 a day and can cost someone their right
-- to work; a failed payment is a billing problem, not a reason to let that
-- happen silently. So the degradation order is deliberate:
--
--   1. immediately  - growth actions stop (new documents, new companies,
--                     uploads, invites). The register stays readable.
--   2. after 30 days - alerts stop too.
--
-- Maintenance actions (mark renewed, acknowledge, correct an expiry date)
-- stay available the whole time. Blocking someone from recording that they
-- fixed a compliance problem would be perverse.
--
-- delinquent_since anchors that 30 days. It is set when the org first
-- enters past_due or cancelled and cleared the moment it is healthy again,
-- so a customer who pays on day 3 and lapses again months later gets a
-- fresh 30 days rather than an expired clock.
-- =====================================================================

alter table public.organizations
  add column delinquent_since timestamptz;

comment on column public.organizations.delinquent_since is
  'When the org first entered past_due/cancelled. Alerts continue for 30 days from here. Null when healthy.';

-- Keep it in step with status automatically, so every path that changes
-- status - webhook, manual fix, SQL - maintains the invariant.
create or replace function public.sync_delinquency()
returns trigger
language plpgsql
as $fn$
begin
  if new.status in ('past_due', 'cancelled') then
    -- Only stamp on ENTERING delinquency, so the clock is not reset by
    -- every later webhook that repeats the same bad status.
    if old.status not in ('past_due', 'cancelled') or new.delinquent_since is null then
      new.delinquent_since := coalesce(old.delinquent_since, now());
    else
      new.delinquent_since := old.delinquent_since;
    end if;
  else
    new.delinquent_since := null;
  end if;
  return new;
end;
$fn$;

create trigger organizations_sync_delinquency
  before update of status on public.organizations
  for each row execute function public.sync_delinquency();

-- ---------------------------------------------------------------------
-- Trial limits.
--
-- A trial has to be big enough to hold a real spreadsheet, or the customer
-- cannot evaluate the thing they are being asked to trust. Growth-sized.
-- ---------------------------------------------------------------------
create or replace function public.signup_org(
  p_company_name text,
  p_full_name text,
  p_entity_name text default null,
  p_trade_licence_number text default null,
  p_emirate text default null,
  p_phone_e164 text default null
)
returns table (org_id uuid, entity_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_org_id uuid;
  v_entity_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'this user already belongs to an organization';
  end if;

  if coalesce(trim(p_company_name), '') = '' then
    raise exception 'company name is required';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;

  insert into public.organizations (name, plan, status, document_limit, entity_limit, trial_ends_at)
  values (trim(p_company_name), 'starter', 'trialing', 250, 1, now() + interval '14 days')
  returning id into v_org_id;

  insert into public.profiles (id, org_id, full_name, email, phone_e164, role)
  values (v_uid, v_org_id, coalesce(trim(p_full_name), ''), v_email, nullif(trim(p_phone_e164), ''), 'owner');

  insert into public.entities (org_id, name, trade_licence_number, emirate, escalation_user_id)
  values (
    v_org_id,
    coalesce(nullif(trim(p_entity_name), ''), trim(p_company_name)),
    nullif(trim(p_trade_licence_number), ''),
    nullif(trim(p_emirate), ''),
    v_uid
  )
  returning id into v_entity_id;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('org_id', v_org_id, 'org_role', 'owner')
   where id = v_uid;

  insert into public.audit_log (org_id, actor_user_id, action, target_table, target_id, metadata)
  values (v_org_id, v_uid, 'org.created', 'organizations', v_org_id,
          jsonb_build_object('company_name', trim(p_company_name)));

  return query select v_org_id, v_entity_id;
end;
$fn$;
