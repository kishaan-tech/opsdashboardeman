# ops-hub — architecture & tech stack

The complete reference for how this system is put together. Read this before
making changes; the [Extending things](#extending-things) section at the bottom
covers the common modification paths.

```
 Typeform          Calendly           Whop/Stripe
    │                 │                   │
    └────── webhooks (via Zapier or native) ──────┐
                                                  ▼
                        ┌──────────────────────────────────┐
                        │  Ingestion API                   │
                        │  · local dev: Express (api/)     │
                        │  · production: Supabase Edge Fn  │
                        │    (supabase/functions/webhooks) │
                        │  validate → log event → upsert   │
                        └───────────────┬──────────────────┘
                                        ▼
   Airtable ── one-time ──▶ ┌──────────────────────┐ ◀── auth'd reads/writes ──┐
   (legacy,     migration   │  Supabase Postgres   │                           │
    retired)   (tools/)     │  6 tables + 2 views  │                  ┌────────┴───────┐
                            │  + ingestion_events  │                  │  Admin UI      │
                            └──────────────────────┘                  │  React + Vite  │
                                                                      │  + Tailwind    │
                                                                      └────────────────┘
```

## Tech stack at a glance

| Layer | Tech | Where |
|---|---|---|
| Database | PostgreSQL on Supabase (project `ydxjiefefxvxzqijwrkq`) | `supabase/migrations/` |
| API (prod) | Supabase Edge Function (Deno, TypeScript) | `supabase/functions/webhooks/index.ts` |
| API (local dev) | Node 22 + Express 4 + Zod 3 | `api/src/` |
| Frontend | React 18 + Vite 5 + Tailwind CSS 4, `@supabase/supabase-js` v2 | `web/src/` |
| Tooling | Node scripts (schema generation + data migration) | `tools/` |
| Repo layout | npm workspaces monorepo (`tools`, `api`, `web`) | root `package.json` |
| Repo | https://github.com/kishaan-tech/opsdashboardeman | — |

Secrets live in `.env` at the repo root (gitignored; template in `.env.example`).
Vite reads the `VITE_`-prefixed vars from the same file (`envDir` points at the root).

---

## Database structure

### Conventions (every domain table)

| Column | Purpose |
|---|---|
| `id uuid` (PK) | primary key, `gen_random_uuid()` |
| `airtable_id text unique` | provenance from the migration; makes re-runs idempotent |
| `source text` + `external_id text` | who sent the record + their id for it; **unique together**, so webhook replays/double-fires update instead of duplicate |
| `created_at`, `updated_at` | `updated_at` auto-maintained by a `before update` trigger (`set_updated_at()`) |

RLS is enabled on every table: the `authenticated` role has full access (the
admin UI), and the API uses the service-role key which bypasses RLS. Anonymous
access sees nothing.

### Tables

**`leads`** — lead_name, email, phone, source_2 (lead source; `_2` suffix because
Airtable also had our reserved `source` column name), set_by, date_added.

**`bookings`** — booking_id (text label from Airtable's formula), start_time
(timestamptz), status, showed_up (bool), closed (bool), cash_collected,
revenue_generated (numeric 12,2), notes, day_key/week_key (formula snapshots),
sales_reps (legacy text), form_link, objection, fathom_link, email_from_email
(jsonb lookup snapshot), email_calendly.
FKs: **`lead_id → leads`**, **`set_by_id → sales_reps`** (setter),
**`closer_id → sales_reps`**.

**`sales_reps`** — rep_name, email, role, set (%), close (%), set_by (count
snapshot), calls_on_cal (count snapshot).

**`transactions`** — transaction_id (e.g. Stripe payment intent), amount
(numeric 12,2), date, status, set_by/closed_by (jsonb lookup snapshots),
setter_commission, closer_commission, day_key, week_key.
FK: **`booking_id → bookings`**.

**`emails`** — campaign_name, send_date, recipients, open_rate, click_rate.

**`setter_eod_report`** — eod_report_name, date, dials, pickups, conversations,
booked_calls, cash_collected, revenue_generated. FK: **`sales_rep_id → sales_reps`**.

**`ingestion_events`** — the audit log (defined in `0001_core.sql`). Every
inbound webhook writes a row *first* (source, event_type, external_id, full
payload jsonb, received_at), then gets `status` = processed/failed/skipped,
the error message on failure, and a pointer (`record_table`, `record_id`) to
the row it wrote. Unique on (source, external_id) → replay detection.

### Views (live, replace Airtable's "Metrics" table)

- **`metrics_weekly`** — per week: new_leads, total_bookings, total_shows,
  total_closes, show_rate, close_rate, cash_collected, revenue_generated,
  transaction_total. Computed from leads/bookings/transactions on every query —
  can never drift.
- **`metrics_daily`** — same idea per day, bookings-based.

Both use `security_invoker = true` so they respect the querying user's RLS.

### Migration files (apply in order; all idempotent)

1. `supabase/migrations/0001_core.sql` — extensions, `set_updated_at()`, `ingestion_events`
2. `supabase/migrations/0002_generated_schema.sql` — **GENERATED** from Airtable, do not hand-edit (see Tooling)
3. `supabase/migrations/0003_metrics_views.sql` — the two views
4. `supabase/apply_all.sql` — all three concatenated, for one-paste applies

---

## Backend / API

Two implementations of the same ingestion pipeline (keep them in sync when
changing behavior):

- **`api/`** — Express, for local dev. Run `npm run api` (port 8787).
- **`supabase/functions/webhooks/index.ts`** — Deno Edge Function, the
  production deployment (no server to maintain, lives in the same Supabase
  project). *Not yet deployed — needs `SUPABASE_ACCESS_TOKEN`, then
  `supabase functions deploy webhooks --no-verify-jwt` + `supabase secrets set
  WEBHOOK_SECRET=…`.*

### Endpoints

All POST, JSON body, guarded by an `x-webhook-secret` header (value =
`WEBHOOK_SECRET` in `.env`). `?source=` tags where the event came from.

| Endpoint | Canonical payload | What it does |
|---|---|---|
| `/webhooks/forms` | `form_name`, `submission_id`, `email` (required), `name`, `phone`, `source`, `answers` | find-or-create **lead** by email; fills empty name/phone; answers preserved on the event row |
| `/webhooks/bookings` | `booking_id`, `starts_at`, `status`, `email` (required), `name` | find-or-create lead → upsert **booking** linked via `lead_id`. Reschedule/cancel = same `booking_id`, new status → row updates |
| `/webhooks/payments` | `payment_id`, `amount`, `status`, `paid_at`, `email` | upsert **transaction**; if the payer's email matches a lead with a booking, link `booking_id` to their most recent booking and — on a success status — set that booking's `closed = true` (close rate inferred from cash) |

Local URLs: `http://localhost:8787/webhooks/…` ·
Deployed URLs: `https://ydxjiefefxvxzqijwrkq.supabase.co/functions/v1/webhooks/…`

### The ingest pipeline (`api/src/lib/ingest.js`)

Every endpoint runs the same four steps: **(1)** insert the raw payload into
`ingestion_events` (a duplicate delivery is caught here by the unique index and
returns `{ok, duplicate}` without touching data) → **(2)** validate against the
route's Zod schema (`api/src/schemas/index.js`) → **(3)** run the route's
`apply()` which does the domain upserts → **(4)** mark the event processed, or
failed with the error text. Nothing is ever silently dropped — the Events page
in the UI is the debugging surface.

---

## Frontend (`web/`)

React 18 + Vite + Tailwind v4 (via `@tailwindcss/vite`), talking **directly to
Supabase** with the anon key + `@supabase/supabase-js`. No custom backend for
reads/writes — RLS is the security boundary, and users must sign in (Supabase
email/password auth; users are created in the dashboard, no self-signup).

**Routing** is a tiny hash router in `App.jsx`:
`#/dashboard` (default) · `#/entity/<table>` · `#/entity/<table>/record/<id>` · `#/events`.

**The UI is schema-driven.** `web/src/config/entities.json` (generated — see
Tooling) declares each entity's table, label, title field, columns (with UI
types: text/number/boolean/date/datetime/json/tags), and relations
(belongsTo / hasMany / manyToMany). The generic pages render whatever is in
that file — a new table needs zero component changes.

| File | Role |
|---|---|
| `pages/DashboardPage.jsx` | KPI tiles (cash, bookings, show rate, close rate, revenue, transactions) + date presets/custom range + weekly breakdown table. Aggregates client-side from `bookings` + `transactions` |
| `pages/EntityPage.jsx` | table view per entity: search (ilike across text cols), value filters, pagination (50/page), row → detail panel |
| `pages/EventsPage.jsx` | `ingestion_events` viewer: status filter, expandable payload + error |
| `pages/Login.jsx` | Supabase email/password sign-in |
| `components/DataTable.jsx` | generic table renderer (first 8 columns) |
| `components/FilterBar.jsx` | search box + auto-built selects for status/stage/type-ish columns |
| `components/DetailPanel.jsx` | slide-over editor: typed fields, save/delete, provenance metadata |
| `components/RelatedRecords.jsx` | renders relations from entities.json, cross-links records |
| `lib/supabase.js` / `lib/format.js` | client singleton / cell formatting + input parsing |

---

## Tooling (`tools/`)

- **`generate-schema.js`** (`npm run generate-schema`) — reads the Airtable
  base via the Metadata API and regenerates three artifacts:
  `0002_generated_schema.sql`, `tools/generated/schema-map.json` (field-level
  map the migration script runs on), and `web/src/config/entities.json`.
  Airtable stores every relationship twice (a link field on each side); the
  generator dedupes to one FK or junction table per relationship.
- **`schema-overrides.json`** — hand-tuning applied on top of Airtable, keyed
  by Airtable names. Current decisions: skip "Table 1" (merged into leads) and
  "Metrics" (replaced by views); skip the duplicate Leads↔Bookings link; force
  Lead/Set By/Closer/Booking links to single FKs; rename "Lead Name" link →
  `lead_id`. Edit this file and regenerate rather than editing generated files.
- **`migrate-airtable.js`** (`npm run migrate`) — two-pass, re-runnable data
  migration: upsert all records on `airtable_id`, then resolve links to FKs;
  reports any unresolved link. Also executes the `mergeTables` overrides
  (Table 1 → leads with email/name dedup). CSV fallback: `--from-csv`.
- **`generate-schema-from-csv.js`** — schema draft from CSV exports when API
  access isn't available (types inferred, links not detectable).

## Running things

```bash
npm install            # all workspaces
npm run web            # admin UI  → localhost:5173 (or launch.json → 5199)
npm run api            # ingestion API → localhost:8787
npm run generate-schema && npm run migrate   # only when re-syncing from Airtable
```

`.env` keys: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side only),
`SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` (browser), `AIRTABLE_API_KEY`,
`AIRTABLE_BASE_ID`, `WEBHOOK_SECRET`, `PORT`.

## Extending things

- **New table**: add it in SQL (follow the conventions block above: id,
  source/external_id unique, updated_at trigger, RLS policy), then add an entry
  to `web/src/config/entities.json` — the UI picks it up. (If it still exists
  in Airtable, prefer: adjust overrides → regenerate → apply.)
- **New data source**: add a Zod schema in `api/src/schemas/`, a route file
  whose `apply()` does the upserts, mount it in `api/src/server.js`, mirror the
  case in the Edge Function. ~30 lines.
- **New dashboard metric**: extend the `m` memo in `DashboardPage.jsx` (client
  aggregation) or add a SQL view like `metrics_weekly` for anything heavier.
- **Schema changed in Airtable pre-cutover**: rerun `npm run generate-schema`,
  review the SQL diff, apply, `npm run migrate` (idempotent).

## Known state / open items

- Edge Function **not yet deployed** (waiting on a Supabase personal access
  token) — until then webhook endpoints exist only locally, and Zaps can't be
  flipped.
- Data quality carried over from Airtable: one duplicated $800 Stripe
  transaction (same payment intent twice), 3 bookings with no lead attached,
  and an "organic" row in sales_reps that is a lead source, not a person.
- Dashboard show-rate denominator currently counts *all* bookings in range
  (including future and canceled ones); agreed improvement is to count only
  past, non-canceled bookings — not yet implemented.
- `bookings.cash_collected` is empty on migrated rows; the Cash tile reads it.
  The Transactions tile reads actual payments — candidate source of truth.
