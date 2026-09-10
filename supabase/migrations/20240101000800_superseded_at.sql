-- =====================================================================
-- Retention needs its own timestamp
--
-- The retention job originally keyed off documents.updated_at, which is
-- wrong in a way that only shows up much later: updated_at is maintained by
-- a trigger and reflects the last EDIT. Correcting a typo on a document
-- superseded two years ago would silently restart its retention clock, so
-- the scan would live on indefinitely - which is precisely the outcome a
-- retention policy exists to prevent.
--
-- superseded_at records when the renewal actually happened and never moves
-- after that.
-- =====================================================================

alter table public.documents
  add column superseded_at timestamptz;

comment on column public.documents.superseded_at is
  'When this document was replaced by a renewal. Anchors retention; never changes once set.';

-- Stamp it whenever superseded_by_id is first set, and clear it if a
-- renewal is ever unlinked, so the column cannot drift from the pointer.
create or replace function public.stamp_superseded_at()
returns trigger
language plpgsql
as $fn$
begin
  if new.superseded_by_id is not null and old.superseded_by_id is null then
    new.superseded_at := coalesce(new.superseded_at, now());
  elsif new.superseded_by_id is null then
    new.superseded_at := null;
  else
    -- Already superseded and still is: hold the original timestamp.
    new.superseded_at := old.superseded_at;
  end if;
  return new;
end;
$fn$;

create trigger documents_stamp_superseded_at
  before update of superseded_by_id on public.documents
  for each row execute function public.stamp_superseded_at();

-- Backfill: the replacement's created_at is when the renewal was recorded.
update public.documents d
   set superseded_at = r.created_at
  from public.documents r
 where d.superseded_by_id = r.id
   and d.superseded_at is null;

-- Anything still unset (replacement deleted) falls back to its own row.
update public.documents
   set superseded_at = updated_at
 where superseded_by_id is not null and superseded_at is null;

drop index if exists documents_retention_idx;
create index documents_retention_idx
  on public.documents (superseded_at)
  where superseded_by_id is not null and file_path is not null;
