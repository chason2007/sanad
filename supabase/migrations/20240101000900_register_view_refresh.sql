-- =====================================================================
-- Refresh document_register so it exposes superseded_at
--
-- `create view ... as select d.*` expands the star ONCE, at creation time.
-- Adding a column to documents afterwards does not appear in the view, and
-- nothing warns you - the column is simply missing and every query that
-- filters on it quietly matches nothing. That is how the retention job came
-- to report zero documents to purge while sitting on a year-old scan.
--
-- Columns are listed explicitly here so the next person adding one gets a
-- compile-time reminder that this view needs updating too.
-- =====================================================================

drop view if exists public.document_register;

create view public.document_register
with (security_invoker = on)
as
select
  d.id,
  d.entity_id,
  d.holder_id,
  d.document_type_id,
  d.document_number,
  d.issue_date,
  d.expiry_date,
  d.file_path,
  d.responsible_user_id,
  d.status,
  d.notes,
  d.superseded_by_id,
  d.superseded_at,
  d.needs_review,
  d.created_at,
  d.updated_at,
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
join public.entities e        on e.id = d.entity_id
join public.document_types dt on dt.id = d.document_type_id
left join public.holders h    on h.id = d.holder_id
left join public.profiles p   on p.id = d.responsible_user_id;

grant select on public.document_register to authenticated, service_role;
