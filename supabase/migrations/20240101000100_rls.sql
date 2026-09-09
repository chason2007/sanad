-- =====================================================================
-- Sanad - Row Level Security
--
-- Design rule: a policy NEVER trusts a value supplied by the client.
-- Every check compares the row against auth_org_id(), which is derived
-- from the verified JWT. A forged org_id in a request body fails the
-- WITH CHECK clause on write and matches nothing on read.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Identity helpers
--
-- Fast path: org_id stamped into the JWT by the custom access token hook
-- (see 20240101000300_auth_hook.sql). Fallback: look it up from profiles.
-- SECURITY DEFINER so the fallback bypasses RLS on profiles - without it
-- the profiles policy would recurse into this function forever.
-- search_path is pinned: a SECURITY DEFINER function with a mutable
-- search_path is a privilege-escalation hole.
-- ---------------------------------------------------------------------
create or replace function public.auth_org_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  claim text;
  result uuid;
begin
  claim := nullif(current_setting('request.jwt.claims', true), '');
  if claim is not null then
    result := ((claim::jsonb -> 'app_metadata') ->> 'org_id')::uuid;
    if result is not null then
      return result;
    end if;
  end if;

  select p.org_id into result from public.profiles p where p.id = auth.uid();
  return result;
exception
  when others then
    -- A malformed claim must deny access, never error the whole query
    -- into an unpredictable state.
    return null;
end;
$fn$;

create or replace function public.auth_role()
returns user_role
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  result user_role;
begin
  select p.role into result from public.profiles p where p.id = auth.uid();
  return result;
end;
$fn$;

-- admin and owner can write. viewer cannot.
create or replace function public.is_org_admin()
returns boolean
language sql
stable
as $fn$ select public.auth_role() in ('owner', 'admin') $fn$;

create or replace function public.is_org_owner()
returns boolean
language sql
stable
as $fn$ select public.auth_role() = 'owner' $fn$;

revoke execute on function public.auth_org_id() from public;
revoke execute on function public.auth_role() from public;
grant execute on function public.auth_org_id() to authenticated, service_role;
grant execute on function public.auth_role() to authenticated, service_role;
grant execute on function public.is_org_admin() to authenticated, service_role;
grant execute on function public.is_org_owner() to authenticated, service_role;
grant execute on function public.dubai_today() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Enable RLS everywhere. No exceptions.
-- ---------------------------------------------------------------------
alter table public.organizations   enable row level security;
alter table public.profiles        enable row level security;
alter table public.entities        enable row level security;
alter table public.holders         enable row level security;
alter table public.document_types  enable row level security;
alter table public.documents       enable row level security;
alter table public.alert_rules     enable row level security;
alter table public.alerts          enable row level security;
alter table public.extraction_jobs enable row level security;
alter table public.audit_log       enable row level security;

-- Force RLS so even a table owner connection is subject to it.
alter table public.organizations   force row level security;
alter table public.profiles        force row level security;
alter table public.entities        force row level security;
alter table public.holders         force row level security;
alter table public.document_types  force row level security;
alter table public.documents       force row level security;
alter table public.alert_rules     force row level security;
alter table public.alerts          force row level security;
alter table public.extraction_jobs force row level security;
alter table public.audit_log       force row level security;

-- ---------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------
create policy org_select on public.organizations
  for select to authenticated
  using (id = public.auth_org_id());

create policy org_update on public.organizations
  for update to authenticated
  using (id = public.auth_org_id() and public.is_org_owner())
  with check (id = public.auth_org_id() and public.is_org_owner());

-- No insert/delete for end users: orgs are created by signup_org() only.

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (org_id = public.auth_org_id());

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (org_id = public.auth_org_id() and public.is_org_owner());

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or (org_id = public.auth_org_id() and public.is_org_owner()))
  with check (org_id = public.auth_org_id());

create policy profiles_delete on public.profiles
  for delete to authenticated
  using (org_id = public.auth_org_id() and public.is_org_owner() and id <> auth.uid());

-- A user editing their own profile must not be able to promote themselves.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'org_id is immutable';
  end if;
  if new.role is distinct from old.role and not public.is_org_owner() then
    raise exception 'only an owner may change a role';
  end if;
  return new;
end;
$fn$;

create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ---------------------------------------------------------------------
-- entities
-- ---------------------------------------------------------------------
create policy entities_select on public.entities
  for select to authenticated
  using (org_id = public.auth_org_id());

create policy entities_write on public.entities
  for all to authenticated
  using (org_id = public.auth_org_id() and public.is_org_admin())
  with check (org_id = public.auth_org_id() and public.is_org_admin());

-- ---------------------------------------------------------------------
-- holders (scoped through entities)
-- ---------------------------------------------------------------------
create policy holders_select on public.holders
  for select to authenticated
  using (exists (
    select 1 from public.entities e
    where e.id = holders.entity_id and e.org_id = public.auth_org_id()
  ));

create policy holders_write on public.holders
  for all to authenticated
  using (public.is_org_admin() and exists (
    select 1 from public.entities e
    where e.id = holders.entity_id and e.org_id = public.auth_org_id()
  ))
  with check (public.is_org_admin() and exists (
    select 1 from public.entities e
    where e.id = holders.entity_id and e.org_id = public.auth_org_id()
  ));

-- ---------------------------------------------------------------------
-- document_types (globals readable by all, writable by none)
-- ---------------------------------------------------------------------
create policy document_types_select on public.document_types
  for select to authenticated
  using (org_id is null or org_id = public.auth_org_id());

create policy document_types_write on public.document_types
  for all to authenticated
  using (org_id = public.auth_org_id() and public.is_org_admin())
  with check (org_id = public.auth_org_id() and public.is_org_admin());

-- ---------------------------------------------------------------------
-- documents (scoped through entities)
-- ---------------------------------------------------------------------
create policy documents_select on public.documents
  for select to authenticated
  using (exists (
    select 1 from public.entities e
    where e.id = documents.entity_id and e.org_id = public.auth_org_id()
  ));

create policy documents_write on public.documents
  for all to authenticated
  using (public.is_org_admin() and exists (
    select 1 from public.entities e
    where e.id = documents.entity_id and e.org_id = public.auth_org_id()
  ))
  with check (public.is_org_admin() and exists (
    select 1 from public.entities e
    where e.id = documents.entity_id and e.org_id = public.auth_org_id()
  ));

-- ---------------------------------------------------------------------
-- alert_rules
-- ---------------------------------------------------------------------
create policy alert_rules_select on public.alert_rules
  for select to authenticated
  using (org_id = public.auth_org_id());

create policy alert_rules_write on public.alert_rules
  for all to authenticated
  using (org_id = public.auth_org_id() and public.is_org_admin())
  with check (org_id = public.auth_org_id() and public.is_org_admin());

-- ---------------------------------------------------------------------
-- alerts (send log; written by the cron job under service_role)
-- ---------------------------------------------------------------------
create policy alerts_select on public.alerts
  for select to authenticated
  using (exists (
    select 1 from public.documents d
    join public.entities e on e.id = d.entity_id
    where d.id = alerts.document_id and e.org_id = public.auth_org_id()
  ));

-- Acknowledging is the one write an ordinary member may make, and only
-- to an alert addressed to them (or to any alert, if they are an admin).
create policy alerts_acknowledge on public.alerts
  for update to authenticated
  using (
    (recipient_user_id = auth.uid() or public.is_org_admin())
    and exists (
      select 1 from public.documents d
      join public.entities e on e.id = d.entity_id
      where d.id = alerts.document_id and e.org_id = public.auth_org_id()
    )
  )
  with check (exists (
    select 1 from public.documents d
    join public.entities e on e.id = d.entity_id
    where d.id = alerts.document_id and e.org_id = public.auth_org_id()
  ));

-- ---------------------------------------------------------------------
-- extraction_jobs
-- ---------------------------------------------------------------------
create policy extraction_jobs_select on public.extraction_jobs
  for select to authenticated
  using (exists (
    select 1 from public.documents d
    join public.entities e on e.id = d.entity_id
    where d.id = extraction_jobs.document_id and e.org_id = public.auth_org_id()
  ));

create policy extraction_jobs_write on public.extraction_jobs
  for all to authenticated
  using (public.is_org_admin() and exists (
    select 1 from public.documents d
    join public.entities e on e.id = d.entity_id
    where d.id = extraction_jobs.document_id and e.org_id = public.auth_org_id()
  ))
  with check (public.is_org_admin() and exists (
    select 1 from public.documents d
    join public.entities e on e.id = d.entity_id
    where d.id = extraction_jobs.document_id and e.org_id = public.auth_org_id()
  ));

-- ---------------------------------------------------------------------
-- audit_log - append only. No update, no delete, for anyone.
-- ---------------------------------------------------------------------
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (org_id = public.auth_org_id() and public.is_org_admin());

create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (org_id = public.auth_org_id());

revoke update, delete on public.audit_log from authenticated;

-- ---------------------------------------------------------------------
-- Grants. RLS filters rows; grants decide who may attempt the verb.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select on public.organizations, public.profiles, public.entities,
  public.holders, public.document_types, public.documents,
  public.alert_rules, public.alerts, public.extraction_jobs, public.audit_log
  to authenticated;
grant insert, update, delete on public.profiles, public.entities, public.holders,
  public.document_types, public.documents, public.alert_rules,
  public.extraction_jobs to authenticated;
grant update on public.organizations, public.alerts to authenticated;
grant insert on public.audit_log to authenticated;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------
-- Register view: expiry urgency computed live against Dubai today.
--
-- security_invoker is MANDATORY. Without it the view runs as its owner
-- and silently bypasses every policy above - a cross-tenant leak wearing
-- a convenience wrapper.
-- ---------------------------------------------------------------------
create view public.document_register
with (security_invoker = on)
as
select
  d.*,
  e.org_id,
  e.name          as entity_name,
  h.name          as holder_name,
  h.holder_type   as holder_type,
  h.identifier    as holder_identifier,
  dt.code         as document_type_code,
  dt.label        as document_type_label,
  p.full_name     as responsible_name,
  p.email         as responsible_email,
  (d.expiry_date - public.dubai_today()) as days_remaining,
  case
    when d.status in ('renewed', 'archived') then d.status
    when d.expiry_date <  public.dubai_today() then 'expired'::document_status
    when d.expiry_date <= public.dubai_today() + 30 then 'expiring_soon'::document_status
    else 'valid'::document_status
  end as computed_status
from public.documents d
join public.entities e       on e.id = d.entity_id
join public.document_types dt on dt.id = d.document_type_id
left join public.holders h    on h.id = d.holder_id
left join public.profiles p   on p.id = d.responsible_user_id;

grant select on public.document_register to authenticated, service_role;
