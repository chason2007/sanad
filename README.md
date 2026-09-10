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

### 3. Apply the schema

```bash
npx supabase link --project-ref <your-ref>
npx supabase db push
```

Five migrations run in order: schema → RLS → signup/storage → seeded
document types → staged extractions.

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

| Criterion | Status |
|---|---|
| Signup → onboarding → holder → upload → correct date → dashboard | Built; **not yet run end to end** (needs a live Supabase) |
| Two orgs cannot see each other's data by any means | **Verified** — 21 tests against real Postgres |
| Counters correct for expiring today / tomorrow / expired last week | **Verified** — those exact cases, plus every bucket boundary |
| All dates render in Asia/Dubai regardless of browser timezone | **Verified** — every assertion repeated in 5 timezones either side of Dubai |
| Files private, signed URLs, 60-second expiry | Built and policy-tested; **signing not yet exercised against live Storage** |

Nothing has run against a live Supabase yet. Auth as enforced by PostgREST
(rather than raw Postgres), Storage signed URLs, Stripe webhooks, and a real
extraction call are all still unexercised.

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

## Not built yet

Phases 1 and 2 are complete. The alert **send** engine is not part of either
phase and is the obvious next piece: the `alerts` table, the idempotency
constraint, per-org lead-day rules, escalation contacts, and notification
preferences are all in place and unused. What is missing is the daily Vercel
Cron job that walks the register and sends.

---

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
    extraction/   prompt, schema, sanity checks
    queries.ts    all register reads
supabase/migrations/
tests/
  db/             real Postgres, real migrations, real RLS
```
