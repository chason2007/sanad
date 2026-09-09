-- =====================================================================
-- Staged extraction jobs
--
-- Why this migration exists:
--
-- The spec asks for two things that cannot both hold at once - documents
-- carry `expiry_date date not null`, and an uploaded file "creates a
-- document row in needs_review state" BEFORE anything has read a date off
-- it. Satisfying both would mean inserting a placeholder expiry date, and a
-- placeholder date in this table is not a harmless nullable-column dodge:
-- it is a row the alert engine will happily fire on. The one thing this
-- product must never do is send a confident reminder for a date nobody
-- read off a document.
--
-- So the review stage lives in extraction_jobs instead. A staged job holds
-- the uploaded file and the model output with no document row attached;
-- confirming it creates the document. Nothing un-reviewed can ever reach
-- the alert engine, expiry_date stays NOT NULL, and the raw response is
-- still persisted for debugging - including for uploads the user abandons,
-- which are exactly the ones worth debugging.
--
-- `documents.needs_review` is kept and still set on low-confidence rows, so
-- a confirmed-but-shaky document stays flagged in the register.
-- =====================================================================

alter table public.extraction_jobs
  alter column document_id drop not null;

alter table public.extraction_jobs
  add column org_id uuid references public.organizations(id) on delete cascade,
  add column entity_id uuid references public.entities(id) on delete cascade,
  add column file_path text,
  add column file_name text,
  add column mime_type text,
  add column warnings jsonb not null default '[]'::jsonb,
  add column created_by uuid references public.profiles(id) on delete set null;

-- A job is either attached to a document or staged against an org. Never
-- floating free with no tenant to scope it to.
alter table public.extraction_jobs
  add constraint extraction_jobs_scoped
  check (document_id is not null or org_id is not null);

create index extraction_jobs_staged_idx
  on public.extraction_jobs(org_id, created_at desc)
  where document_id is null;

-- Backfill org_id for any existing attached jobs so the policies below
-- can lean on it uniformly.
update public.extraction_jobs j
   set org_id = e.org_id
  from public.documents d
  join public.entities e on e.id = d.entity_id
 where j.document_id = d.id and j.org_id is null;

-- ---------------------------------------------------------------------
-- Replace the RLS policies: they previously joined through documents,
-- which a staged job does not have.
-- ---------------------------------------------------------------------
drop policy if exists extraction_jobs_select on public.extraction_jobs;
drop policy if exists extraction_jobs_write on public.extraction_jobs;

create policy extraction_jobs_select on public.extraction_jobs
  for select to authenticated
  using (
    org_id = public.auth_org_id()
    or exists (
      select 1 from public.documents d
      join public.entities e on e.id = d.entity_id
      where d.id = extraction_jobs.document_id and e.org_id = public.auth_org_id()
    )
  );

create policy extraction_jobs_write on public.extraction_jobs
  for all to authenticated
  using (
    public.is_org_admin() and (
      org_id = public.auth_org_id()
      or exists (
        select 1 from public.documents d
        join public.entities e on e.id = d.entity_id
        where d.id = extraction_jobs.document_id and e.org_id = public.auth_org_id()
      )
    )
  )
  with check (
    public.is_org_admin() and (
      org_id = public.auth_org_id()
      or exists (
        select 1 from public.documents d
        join public.entities e on e.id = d.entity_id
        where d.id = extraction_jobs.document_id and e.org_id = public.auth_org_id()
      )
    )
  );
