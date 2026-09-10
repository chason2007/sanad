-- =====================================================================
-- Retryable alert delivery
--
-- The unique index gives us at-most-once sending, which is the property
-- that makes these reminders trustworthy. But it also means a row whose
-- send FAILED can never be retried: its key already exists, so the next
-- run treats it as done. A transient outage at the email provider on the
-- morning a visa expires would therefore lose that reminder silently -
-- exactly the failure this product exists to prevent.
--
-- Retrying a failed send is not the same as sending twice: nothing was
-- delivered. This adds a bounded attempt counter so the daily job can
-- re-try genuine failures without ever re-sending a delivered message,
-- and without hammering a permanently bad address forever.
-- =====================================================================

alter table public.alerts
  add column attempts int not null default 0,
  add column last_attempt_at timestamptz;

-- The retry sweep looks for unsent rows with attempts left. Partial index
-- so it stays cheap as the send log grows.
create index alerts_retryable_idx
  on public.alerts (created_at)
  where sent_at is null or delivery_status = 'failed';

comment on column public.alerts.attempts is
  'Delivery attempts made. Bounded retry; see /api/cron/alerts.';
