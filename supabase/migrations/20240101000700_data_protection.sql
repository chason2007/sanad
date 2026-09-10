-- =====================================================================
-- Data protection (UAE PDPL)
--
-- This database holds passport, visa and Emirates ID scans. Everything in
-- here exists to make the careless path impossible rather than merely
-- discouraged.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Retention
--
-- A superseded scan is last year's visa. The compliance RECORD must stay -
-- an auditor may ask what the licence looked like three renewals ago - but
-- the image of somebody's passport does not need to live forever to answer
-- that. So retention removes the file and the extracted personal data, and
-- keeps the row.
--
-- Minimum 30 days so nobody can set this to 0 and destroy evidence of a
-- renewal they made this morning.
-- ---------------------------------------------------------------------
alter table public.organizations
  add column data_retention_days int not null default 365
    check (data_retention_days >= 30 and data_retention_days <= 3650);

comment on column public.organizations.data_retention_days is
  'Days a superseded document keeps its scan and extracted PII. The register row is kept forever; only the file and personal data are purged.';

-- The retention job looks for superseded documents that still have a file.
create index documents_retention_idx
  on public.documents (updated_at)
  where superseded_by_id is not null and file_path is not null;

-- ---------------------------------------------------------------------
-- The bucket must never become public.
--
-- One careless click in the dashboard, or one migration written in a hurry,
-- would expose every passport scan in the system at a guessable URL. A
-- trigger is the only thing that survives both.
-- ---------------------------------------------------------------------
create or replace function public.forbid_public_document_bucket()
returns trigger
language plpgsql
as $fn$
begin
  if new.id = 'documents' and new.public is true then
    raise exception
      'The documents bucket must stay private: it holds passport and Emirates ID scans. Serve files through short-lived signed URLs instead.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists buckets_forbid_public_documents on storage.buckets;
create trigger buckets_forbid_public_documents
  before insert or update on storage.buckets
  for each row execute function public.forbid_public_document_bucket();

-- ---------------------------------------------------------------------
-- Erasure.
--
-- "Delete my organization" has to actually delete. Storage objects are
-- removed by the application first (Postgres cannot reach the object
-- store), then this removes every row. Everything hangs off organizations
-- by ON DELETE CASCADE, including the audit log - which is correct for an
-- erasure request even though it is uncomfortable: keeping an audit trail
-- of a tenant you were asked to forget defeats the request.
--
-- Runs as definer so a signed-in owner can erase their own org without
-- holding service-role credentials.
-- ---------------------------------------------------------------------
create or replace function public.delete_own_organization(p_confirm_name text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_org_id uuid := public.auth_org_id();
  v_name text;
  v_users uuid[];
begin
  if v_org_id is null then
    raise exception 'not authenticated';
  end if;
  if public.auth_role() <> 'owner' then
    raise exception 'only the owner may delete an organization';
  end if;

  select name into v_name from public.organizations where id = v_org_id;
  if v_name is null then
    raise exception 'organization not found';
  end if;

  -- Typing the name is the last safety catch on an irreversible action.
  if trim(p_confirm_name) is distinct from v_name then
    raise exception 'the confirmation name does not match';
  end if;

  select array_agg(id) into v_users from public.profiles where org_id = v_org_id;

  delete from public.organizations where id = v_org_id;

  -- Remove the auth users too, or they sign in tomorrow to a dead account
  -- with no organization and no way forward.
  if v_users is not null then
    delete from auth.users where id = any(v_users);
  end if;

  return coalesce(array_length(v_users, 1), 0);
end;
$fn$;

revoke execute on function public.delete_own_organization(text) from public, anon;
grant execute on function public.delete_own_organization(text) to authenticated;
