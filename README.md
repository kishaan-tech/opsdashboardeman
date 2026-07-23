# ops-hub

Internal operations stack: Airtable → Supabase (Postgres) migration, direct webhook ingestion (replaces Zapier), and a lightweight admin UI.

```
ops-hub/
├── supabase/migrations/   SQL migrations (core infra + your generated schema)
├── tools/                 Schema generator, migration, webhook registration
├── server/                Express ingestion API (forms / bookings / payments)
├── api/                   Vercel serverless entry (wraps server/)
├── web/                   React + Tailwind admin UI (schema-driven)
└── data/csv/              Drop Airtable CSV exports here if not using the API
```

## How the pieces fit

1. **Schema generation** — `tools/generate-schema.js` reads your Airtable base via the
   [Metadata API](https://airtable.com/developers/web/api/get-base-schema) and emits three artifacts:
   - `supabase/migrations/0002_generated_schema.sql` — Postgres DDL (tables, FKs, junction tables, indexes, RLS)
   - `tools/generated/schema-map.json` — field-level mapping consumed by the migration script
   - `web/src/config/entities.json` — entity config consumed by the admin UI

   The repo ships with a small **example schema** (contacts / bookings / payments / form_submissions) in all
   three places so you can run everything end-to-end before wiring in your real base. Regenerating overwrites it.

2. **Migration** — `tools/migrate-airtable.js` pulls every record from the Airtable API (or `data/csv/`),
   upserts into Postgres keyed on `airtable_id` (idempotent — safe to re-run), then resolves linked-record
   fields into real foreign keys in a second pass.

3. **Ingestion API** — `api/` exposes `POST /webhooks/forms|bookings|payments`. Every inbound event is
   written to `ingestion_events` first (payload, source, timestamp), then validated and upserted. Failures
   are recorded on the event row with the error — nothing is silently dropped. Point your form tool,
   booking tool, and payment processor webhooks straight at these endpoints.

4. **Admin UI** — `web/` renders a table view per entity with search, column filters, an edit panel, and
   related-record navigation, all driven by `entities.json`. Adding a table = one new entry in that file
   (or just regenerate it).

## Deploy (Vercel)

One Vercel project serves the admin UI **and** the webhook API.

1. Push this repo, then `npx vercel` (or Import in the Vercel dashboard).
2. Set env vars on the project (Production):  
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEBHOOK_SECRET`,  
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,  
   `TYPEFORM_API_KEY`, `CALENDLY_API_KEY` (optional).
3. Apply `supabase/migrations/0004_webhook_fields.sql` in the Supabase SQL editor (once).
4. Point webhooks at the deployment:
   ```bash
   WEBHOOK_BASE_URL=https://YOUR-APP.vercel.app npm run register-webhooks
   ```
   Endpoints:
   - `POST /api/webhooks/forms?source=typeform&secret=…`
   - `POST /api/webhooks/bookings?source=calendly&secret=…`
   - `POST /api/webhooks/payments?source=whop&secret=…`
   - `GET  /api/health`

## Setup

### 0. Prereqs
- A Supabase project ([database → connection settings] for the connection string; [settings → API] for keys)
- An Airtable personal access token with `schema.bases:read` + `data.records:read` scopes

### 1. Configure
```bash
cp .env.example .env   # then fill in the values
npm install            # installs all workspaces (tools, server, web)
```

### 2. Core migration (always run first)
Apply `supabase/migrations/0001_core.sql` via the Supabase SQL editor or CLI:
```bash
npx supabase db push        # if using the Supabase CLI, or paste into the SQL editor
```

### 3. Generate your schema from Airtable
```bash
npm run generate-schema     # reads AIRTABLE_API_KEY + AIRTABLE_BASE_ID from .env
```
Review `supabase/migrations/0002_generated_schema.sql`, then apply it the same way as step 2.

No API access? Drop CSV exports into `data/csv/` (one file per table, named `<Table Name>.csv`) and run
`npm run generate-schema:csv`. CSV headers carry less type information, so review the generated SQL more carefully.

### 4. Migrate your data
```bash
npm run migrate             # or: npm run migrate -- --from-csv
```
Re-runnable: records upsert on `airtable_id`, so partial failures can just be retried.

### 5. Run the stack
```bash
npm run api    # ingestion API on :8787
npm run web    # admin UI on :5173
```

Webhook URLs locally use `/webhooks/…`; on Vercel they use `/api/webhooks/…` (both work in the Express app).

## Design notes

- **Every table** gets `id uuid` (PK), `airtable_id text unique` (provenance + dedup), `created_at`,
  `updated_at` (auto-maintained by trigger).
- **Webhook dedup**: domain tables carry `source` + `external_id` with a unique index; the ingest layer
  upserts on it, so replayed webhooks are idempotent.
- **Auditability**: `ingestion_events` is the source of truth for "what came in, when, from where, and did
  it work". The admin UI has an Events page over it.
- **RLS**: enabled on all tables. Authenticated users get full access (single-operator internal tool);
  the API uses the service-role key and bypasses RLS. Tighten policies in `0001_core.sql` /
  the generated SQL if you add teammates with restricted roles.
- **Adding a data source**: add a Zod schema in `server/src/schemas/`, a route file that calls
  `ingest()` in `server/src/routes/`, and mount it in `server/src/app.js`. ~30 lines.
