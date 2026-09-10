# Sanad

Document-expiry and compliance tracking for UAE companies. Replaces the
spreadsheet that everyone forgets to open.

The entire value of this app is that an alert fires correctly on the right
day. Everything below is organised around not breaking that.

---

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local
```

### 2. Create a Supabase project

**Region: Frankfurt (`eu-central-1`).** Mumbai is physically closer to the
UAE and about 75ms faster, but it puts customer data under India's DPDP Act.
Frankfurt puts it under EU GDPR, which is the regime enterprise buyers and
their legal teams actually ask about, and it makes cross-border questions
answerable with an adequacy decision rather than an argument. For a product
whose buyers are compliance-minded by definition, that is worth the latency.

Supabase cannot move a project between regions - if you need to change it,
create a new project and re-run the migrations.

Then fill in `.env.local`:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API (**server only, never expose**) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `RESEND_API_KEY` | resend.com |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe dashboard |
| `STRIPE_PRICE_*` | One price ID per plan in `src/lib/plans.ts` |
| `CRON_SECRET` | Any long random string |
| `ALERT_LINK_SECRET` | Signs email action links. Falls back to `CRON_SECRET`. |
| `NEXT_PUBLIC_SUPABASE_REGION` | `eu-central-1`. Shown verbatim in the app and the data export, so keep it truthful. |

### 3. Apply the schema

```bash
npx supabase link --project-ref <your-ref>
npx supabase db push
```

Five migrations run in order: schema → RLS → signup/storage → seeded
document types → staged extractions.

**If port 5432 is blocked** (corporate network, some CI runners), `db push`
cannot open a Postgres connection. Use the HTTPS fallback instead, which
applies the same files and records them in the same
`supabase_migrations.schema_migrations` table, so a later `db push` from an
unblocked network sees them as already applied:

```bash
SUPABASE_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<pat>   node scripts/apply-migrations.mjs        # --dry to preview
```

### 4. Configure auth

In the Supabase dashboard:

- **Authentication → URL Configuration**: add `http://localhost:3000/auth/callback`
  (and your production equivalent) as a redirect URL.
- **Authentication → Providers → Email**: enable email/password and magic link.
- For local development, turn **off** email confirmation, or signup cannot
  complete `signup_org` in one pass and lands on the login screen instead.

### 5. Run

```bash
npm run dev
```

---

## Verification

```bash
npm test        # 94 tests
npm run build   # production build, 19 routes
npm run typecheck
```

### What the tests actually prove

`tests/db/` applies **the real migration files** to a real Postgres and runs
as the real `authenticated` role with JWT claims set the way PostgREST sets
them. There is no Docker on the original dev machine, so this uses PGlite
(in-process Postgres) with a thin shim for the `auth` and `storage` schemas
Supabase provides. Nothing about the policies is mocked.

Tenant isolation is covered from both directions — that a tenant sees its
own rows, and that it sees nothing of anyone else's:

- cross-tenant reads on every table and on the `document_register` view
- a forged entity id in the payload
- tenant-hopping via `UPDATE ... SET org_id`
- viewer write attempts and viewer file downloads
- self-promotion to owner
- audit-log tampering
- `org_id` spoofed through `user_metadata` (which **is** client-writable in
  Supabase — this is why `auth_org_id()` reads `app_metadata` only)

### Phase 1 acceptance criteria

All five were re-verified against a live Supabase project (`sanad`,
ap-south-1), not only against the local test suite.

| Criterion | Status |
|---|---|
| Signup → onboarding → holder → upload → correct date → dashboard | **Verified live** — walked end to end in the browser |
| Two orgs cannot see each other's data by any means | **Verified live through PostgREST**, plus 21 tests against raw Postgres |
| Counters correct for expiring today / tomorrow / expired last week | **Verified live** — 1 / 2 / 2 / 1 against those exact seeded rows |
| All dates render in Asia/Dubai regardless of browser timezone | **Verified** — every assertion repeated in 5 timezones either side of Dubai |
| Files private, signed URLs, 60-second expiry | **Verified live** — public URL 400, signed URL 200, `exp - iat` exactly 60 |

### The live isolation test

A second org was created through the real signup RPC, then used to attack the
first over the REST API with its own valid JWT:

| Attack | Result |
|---|---|
| List documents / register / holders | `[]` |
| Fetch org A's document by its exact id | `[]` |
| List organizations / profiles | only its own |
| INSERT with org A's `entity_id` forged into the payload | `42501` RLS violation |
| UPDATE / DELETE org A's document | `[]` — zero rows |
| Move its own entity into org A (tenant hop) | `42501` RLS violation |

Org A finished the run with its 4 documents and 5 holders intact and
untampered. Note that org B's token was issued *before* its profile existed,
so this also exercised the `auth_org_id()` fallback path rather than the JWT
fast path.

Still unexercised: a real extraction call (needs `ANTHROPIC_API_KEY`), Resend
email, and Stripe webhooks.

---

## Design decisions worth knowing

### Dates

Every date goes through `src/lib/dates.ts`. Nothing calls `new Date()` and
reads a day off it. Expiry dates are Postgres `date` columns and travel as
plain `yyyy-MM-dd` strings — they are calendar facts, not instants, and are
never timezone-converted. Converting them is exactly what produces the
off-by-one where a document appears to expire yesterday.

In SQL, the only "today" is `dubai_today()`.

This is not theoretical: the timezone test suite caught `formatDate` building
a UTC-midnight instant and letting date-fns render it in local time, which
showed every expiry a day early in any negative-offset timezone.

### Alert idempotency

```sql
create unique index alerts_idempotency_idx
  on alerts(document_id, lead_day, channel, recipient_user_id);
```

A retry, a double cron run, or two overlapping deploys can never send the
same person the same reminder for the same document twice.

### Extraction never auto-saves

The spec asks for `documents.expiry_date NOT NULL` **and** for an uploaded
file to create a document row before anything has read a date off it. Both
cannot hold.

Rather than insert a placeholder expiry — which is a row the alert engine
will happily fire on — the review stage lives in `extraction_jobs`, and
confirming creates the document. Nothing un-reviewed can reach the alert
engine, `expiry_date` stays `NOT NULL`, and the raw model response is still
persisted for debugging, including for uploads the user abandons (which are
the ones most worth debugging).

`documents.needs_review` is kept and still set on low-confidence rows.

### Confidence is checked, not trusted

The model's self-reported confidence is a signal, not evidence.
`sanityCheck` applies deterministic checks that can only ever **lower** it:
swapped or equal issue/expiry dates, malformed dates, unknown type codes,
implausible horizons. A confident `0.97` with the dates swapped lands at
`0.3` and goes to review.

Below `0.8` the document is flagged `needs_review` and surfaced with the
expiry field highlighted and the model's own reasoning shown.

`confirmExtraction` records whether the user changed the proposed date. Over
a few thousand uploads that is the only honest measure of extraction quality.

### Security posture

- RLS is enabled **and forced** on every table.
- `auth_org_id()` is `SECURITY DEFINER` with a pinned `search_path`, reading
  `app_metadata` from the verified JWT with a fallback to `profiles`.
- `document_register` is declared `security_invoker = on`. Without it the
  view would run as its owner and silently bypass every policy — a
  cross-tenant leak wearing a convenience wrapper.
- Storage is a private bucket keyed by `org_id` as the first path segment.
  Viewers cannot download: enforced in the action *and* in the storage
  policy.
- The audit log is append-only; `UPDATE` and `DELETE` are revoked.
- The Stripe webhook verifies the signature against the raw body before
  trusting anything, and is the only thing that changes entitlements.
- CSV export escapes formula injection (`=`, `+`, `-`, `@`) — those values
  came off an uploaded document and land in Excel.

### The register is loaded whole and filtered client-side

At the size this product targets — a 15-100 person firm, so hundreds of
documents — this keeps filtering and sorting instant with no round trip per
keystroke. If a customer crosses into five figures, `/documents` is the
screen to paginate first.

### Arabic in the PDF

pdf-lib's standard fonts are WinAnsi and throw on Arabic, which every UAE
register will contain. The report transliterates what it can and marks the
rest, and says so on screen. The CSV export is UTF-8 with a BOM and carries
the real names — that is the path for anyone who needs them intact.

Fixing this properly means embedding a font with Arabic coverage and solving
right-to-left shaping.

---

## The alert engine

`POST /api/cron/alerts`, scheduled in `vercel.json` at `0 3 * * *` — 03:00
UTC, which is 07:00 Gulf Standard Time, so the reminder is in the inbox
before the UAE working day starts. GST has no daylight saving, so that
mapping holds year-round. Protected by a bearer token in `CRON_SECRET`;
Vercel Cron sends it automatically. Both GET and POST work, because Vercel
invokes crons with GET.

Always dry-run first:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET"   "$APP_URL/api/cron/alerts?dry_run=true"
```

It returns the whole plan — what it would send, to whom, the exact subject
line, what it would escalate, which statuses it would move, and everything
it skipped with a reason — and writes nothing.

### Ordering, and why it is this way round

The alert row is **INSERTed first** with `delivery_status: 'queued'`, and
only then is the email sent. The unique index on `(document_id, lead_day,
channel, recipient_user_id)` is what *claims* the send: if two runs overlap,
the second insert fails and that run skips.

Sending first and recording afterwards would mean a crash in between
produces a duplicate on the next run. Being chased twice for the same
document on the same day is the fastest way to make someone stop reading
these emails, and then the product is worthless.

The cost of that ordering is a row claimed but never sent if the process
dies in between. Two sweeps cover it, both bounded by `attempts < 3` and a
24-hour window so a permanently bad address is not retried nightly forever:

- `queued` with no `sent_at`, older than 15 minutes — the crash case
- `failed` — the provider was down or rejected it

Retrying those is **not** re-sending: nothing was delivered. `sent_at` is
only stamped on success, so an undelivered reminder stays visibly
undelivered.

### Escalation

An alert unacknowledged after 48 hours, on a lead day of 30 or fewer, goes
to the entity's `escalation_user_id`. Long-horizon reminders (60, 90) are
deliberately excluded — escalating those trains people to ignore the
escalation itself. It never escalates to the person who already ignored it,
and `escalated_at` is stamped even if that send fails, so a broken mailbox
cannot re-escalate the same alert every night.

### The email links

Both buttons are HMAC-signed, scoped to one alert and one action, and expire
after 60 days. Signed with `ALERT_LINK_SECRET` (falling back to
`CRON_SECRET`) — kept separate because rotating it invalidates every link
already sitting in someone's inbox.

The link opens a page; the page posts. **Acknowledging is never a GET.**
Corporate mail gateways and Gmail's image proxy fetch every URL in an email
to scan it, so a GET-to-acknowledge would let a spam filter silently
acknowledge alerts nobody read — and escalation, the feature that catches a
reminder being ignored, would quietly stop working. Verified: four GETs of a
live link acknowledged nothing.

### Verified against live data

| Check | Result |
|---|---|
| Missing / wrong bearer token | `401` |
| Dry run | 1 send (lead day 0), 3 status updates, nothing written |
| Real run, then re-run | 1 row total; second run skipped `already_sent` |
| Undelivered retry | attempts 1 → 2 → 3, then stops |
| `sent_at` on failure | stays `null` |
| Emailed link, no session | renders the document, thumb-sized actions |
| GET the link 4× | `acknowledged_at` still null |
| Tampered token | rejected |
| Click Acknowledge | stamped, attributed, audited `via: email_link` |
| Escalation after 50h | goes to the manager, not the person who ignored it |
| After acknowledgement | escalation stops |

## Monthly compliance report

`POST /api/cron/monthly-report`, scheduled `0 3 1 * *` — the 1st at 07:00
GST. One page per entity, rendered with `@react-pdf/renderer`, emailed as
PDF attachments to every owner and admin, with a summary table in the body
so the numbers are readable without opening anything.

Each page carries the compliance percentage, counts by status, everything
expiring in the next 60 days, and everything already expired.

**One page is enforced, not hoped for.** react-pdf paginates happily, so
rows are capped by a budget and the overflow is stated honestly (`+ 38 more
in the register`). Expired rows claim the budget first — they are the ones
costing money. Rows are a fixed height with text clipped per column, because
a wrapped cell is a taller row and a taller row silently produces page two.
There is a test that renders 400 documents, and another with deliberately
huge names, and both assert exactly one page.

Compliance % is the share of live documents that have **not lapsed** — a
document due in three weeks still counts as compliant. Counting it against
the score would make 100% unreachable and the number ignorable.

## Billing

| Plan | AED/month | Entities | Documents |
|---|---|---|---|
| Starter | 149 | 1 | 50 |
| Growth | 399 | 1 | 250 |
| Multi-entity | 999 | 10 | 2,000 |

Stripe Checkout for all three, plus the Customer Portal for self-serve plan
changes and card updates. `customer.subscription.updated` and `.deleted`
sync `organizations.status` and both limits; the webhook verifies its
signature against the raw body and is the only thing that changes
entitlements.

Limits are enforced on document and entity creation with a sentence the
user can act on — never a silent failure:

> You have used all 50 documents on your plan. Upgrade to Growth
> (AED 399/month) for 250 documents.

The upload route checks the limit **before** storing the file or calling the
model, so a refused upload costs nothing. It returns `402` and the UI shows
an amber upgrade prompt rather than a red error, because hitting a plan
limit is not a mistake the user made.

### When a payment fails, alerts are the last thing to go

```
day 0   payment fails  ->  creating stops. Reminders keep sending.
                           Renewing, acknowledging and correcting dates
                           all still work.
day 30  grace expires  ->  reminders stop. The register stays readable.
```

The monthly report stops at day 0 with everything else, because it is a
management convenience. The reminders are the safety mechanism, so they run
the full 30 days.

This ordering is deliberate. A lapsed employee visa costs AED 100 a day and
can cost someone their right to work. Cutting that off because a card
expired would mean the customer finds out from a fine — and it is simply the
wrong thing to do. `organizations.delinquent_since` anchors the 30 days,
maintained by a database trigger so every path that changes status keeps the
invariant: stamped on entry, never reset by a repeat webhook, cleared the
moment the org is healthy again.

Maintenance actions are never blocked, even fully lapsed. Stopping someone
from recording that they *fixed* a compliance problem would keep the alert
firing and help nobody.

Verified live: `past_due` day 0 → alerts still scan every document, report
skipped as `billing grace`. Day 31 → alerts silenced, org named in
`silenced_orgs`. Recovered → both resume. Limit at 4/4 → upload refused with
the upgrade prompt, and no document, job, file or extraction call created.

## Data protection (UAE PDPL)

This app holds passport, visa and Emirates ID scans. The controls below are
built so that the careless path is impossible rather than merely
discouraged.

### Files

The bucket is private and **cannot be made public**. A database trigger
rejects the change, so one careless click in the Supabase dashboard or one
migration written in a hurry cannot expose every scan at a guessable URL.
Verified live — a direct superuser `UPDATE storage.buckets SET public = true`
is refused:

> The documents bucket must stay private: it holds passport and Emirates ID
> scans. Serve files through short-lived signed URLs instead.

Files are reachable only through signed URLs that expire in **60 seconds**,
minted server-side after a role check. Viewers cannot download at all —
enforced in the action *and* in the storage policy.

**Every file view writes to the audit log**, including staged uploads that
have not become documents yet. That one was a real gap: a passport scan
could be opened from the upload review screen with no record of it.

### Logging

Nothing raw is ever handed to `console`. Everything goes through
`lib/privacy.ts`, which redacts before emitting:

- personal fields by name (`holder_name`, `document_number`, `notes`,
  `file_path`, `raw_response`, …) — a name is personal data whether or not
  it looks like one
- patterns anywhere in free text: storage paths, UUIDs, emails, phone
  numbers, Emirates ID numbers, API keys and JWTs
- base64 blobs, so an inlined scan cannot be dumped into a log line
- error stacks, trimmed to four frames and scrubbed

Errors returned to the user are scrubbed too: a storage failure says
"Could not store that file" rather than echoing an object key containing
org and document ids.

If a third-party error tracker is ever added, wire it through `log` so it
inherits the same scrubbing rather than getting its own raw feed.

### Retention

`organizations.data_retention_days` (default 365, floor of 30 enforced by a
check constraint). A daily job purges superseded documents past it:

| deleted | kept |
|---|---|
| the scan file | the document row |
| extracted PII in `extraction_jobs.raw_response` | dates, type, holder, renewal chain |

An auditor asking what a licence looked like three renewals ago is answered
by the row. Nobody needs an image of somebody's passport to answer it, and
keeping it once it has served its purpose is the part you cannot justify.

Retention is keyed off `superseded_at`, **not** `updated_at`. That was a
bug the live test caught: `updated_at` is maintained by a trigger and moves
on every edit, so correcting a typo on a document superseded two years ago
would silently restart its retention clock and the scan would live forever.

Verified live: the bucket went from 1 object to 0, and the row survived with
its dates intact and `file_path` null.

### Export and erasure

Both built before launch, both self-serve, both owner-only.

**`GET /api/export`** returns a ZIP: every table as JSON, the register as
CSV, and every stored scan foldered by company. The ZIP writer is
hand-rolled (`lib/zip.ts`) rather than a dependency — the format is small
and fully specified, Node ships `crc32` and raw deflate, and fewer third
parties touching a stream of passport scans is worth a hundred lines.
Verified by opening the output with Windows `Expand-Archive`: nested
folders, deflated JSON, stored PDF, exact bytes.

**Delete my organisation** removes storage objects first (Postgres cannot
reach the object store, and once the rows are gone nothing remembers which
objects were this tenant's), then every row by cascade, then the auth users.
The audit log goes too — keeping a trail about a tenant you were asked to
forget defeats the request.

Guarded three ways: owner only, the organisation name must be typed to
confirm, and the check runs inside the database function so it holds however
it is called. Verified live: wrong name refused, non-owner refused, and a
real erasure removed the org, profile, entity, audit rows and auth user
while the neighbouring tenant was untouched.

### Where the data physically lives

Documented in `lib/residency.ts` and surfaced at **Settings → Data &
privacy**, so the answer is in the product rather than in a wiki that drifts.
It lists the primary region, every subprocessor, what each one sees, and the
guarantees above. Set `NEXT_PUBLIC_SUPABASE_REGION` to match the deployed
project.

## Scope: what this product does not do

Every item below will be requested. All of them dilute the product, and the
answer is no:

payroll · attendance · leave management · e-signature · document generation ·
government portal submission · mobile apps · chat · an AI assistant

Sanad tracks expiry dates and makes the right person act before the
deadline. The AI in it reads a date off a scan and then gets out of the way.

## Not built yet

WhatsApp delivery (the `alert_channel` enum and notification preference
exist; no provider is wired). A real extraction call has still never run,
and no email has actually been delivered — `RESEND_API_KEY` and
`ANTHROPIC_API_KEY` are both unset.

## Layout

```
src/
  app/
    (app)/        dashboard, documents, holders, upload, reports, settings
    (auth)/       login, signup
    actions/      server actions - every mutation, with audit logging
    api/          extract, reports, stripe webhook
  components/     screens + hand-written shadcn-style primitives
  lib/
    dates.ts      Asia/Dubai. The only source of "today".
    register.ts   counters, filters, sort, CSV - all pure, all tested
    privacy.ts    PII scrubbing. Nothing reaches console except through it.
    residency.ts  where data lives, and every subprocessor
    zip.ts        dependency-free archive writer for the data export
    billing.ts    entitlements and the degradation order
    alerts/       planner, tokens, email templates
    extraction/   prompt, schema, sanity checks
    reports/      monthly one-pager (react-pdf), on-demand report (pdf-lib)
    queries.ts    all register reads
supabase/migrations/
tests/
  db/             real Postgres, real migrations, real RLS
```
