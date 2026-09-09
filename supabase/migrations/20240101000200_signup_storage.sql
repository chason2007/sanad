-- =====================================================================
-- Sanad - signup transaction, JWT claim stamping, private file storage
-- =====================================================================

-- ---------------------------------------------------------------------
-- signup_org: org + first entity + owner profile, atomically.
--
-- Called once, by a freshly authenticated user who has no profile yet.
-- SECURITY DEFINER because the profiles INSERT policy requires an
-- existing owner, and at this instant there is none - a chicken-and-egg
-- that only a definer function can break. The guard below is what keeps
-- it from being an org-creation free-for-all.
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
  values (trim(p_company_name), 'starter', 'trialing', 100, 1, now() + interval '14 days')
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

  -- Stamp the org onto the user so auth_org_id() can read it straight
  -- from the JWT on the next token issue instead of hitting profiles.
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

revoke execute on function public.signup_org(text, text, text, text, text, text) from public, anon;
grant execute on function public.signup_org(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Keep the JWT claim in step with the profiles table. If an owner
-- changes someone's role, the next token they get says so.
-- ---------------------------------------------------------------------
create or replace function public.sync_user_claims()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('org_id', new.org_id, 'org_role', new.role)
   where id = new.id;
  return new;
end;
$fn$;

create trigger profiles_sync_claims
  after insert or update of org_id, role on public.profiles
  for each row execute function public.sync_user_claims();

-- ---------------------------------------------------------------------
-- Private document storage.
--
-- Public = false is the whole point: files are reachable only through a
-- short-lived signed URL minted server-side after a role check.
-- Object key convention: {org_id}/{entity_id}/{document_id}/{filename}
-- so the first path segment is the tenant boundary.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 15728640,
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy documents_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
    -- viewer is read-only in the register but may NOT pull files.
    and public.is_org_admin()
  );

create policy documents_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
    and public.is_org_admin()
  );

create policy documents_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
    and public.is_org_admin()
  );

create policy documents_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
    and public.is_org_admin()
  );
