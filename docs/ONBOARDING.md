# Onboarding a new client org (multi-tenant ops-hub)

## Prerequisites

1. Apply migrations through `0011_org_provider_slots.sql` (or via Supabase MCP / SQL editor).
2. Set **platform** env vars (Vercel + local `.env`):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - `WEBHOOK_SECRET` (legacy fallback for the seeded `dooly` org)
3. Bootstrap yourself as platform admin (SQL editor):

```sql
insert into public.platform_admins (user_id, note)
values ('<YOUR_AUTH_USER_UUID>', 'founder')
on conflict do nothing;

insert into public.org_memberships (org_id, user_id, role)
values (
  'a0000000-0000-4000-8000-000000000001',
  '<YOUR_AUTH_USER_UUID>',
  'org_admin'
)
on conflict (org_id, user_id) do nothing;
```

## Checklist: new client

1. Sign in → **Admin portal** (`#/admin`) → **Create org** (pick a short slug, e.g. `acme`).
2. On the org detail page, set **Providers** (multi-select — a client can enable several per channel):
   - Forms: `typeform`, `iclosed`
   - Bookings: `calendly`, `iclosed`
   - Payments: `whop`, `fanbasis` (each selected processor can set closed / cash)
3. Copy the env var names shown.
4. In **Vercel → Settings → Environment Variables** (and local `.env`), set at least:

```bash
ORG_ACME_WEBHOOK_SECRET=          # openssl rand -hex 24
# Only if using Typeform / Calendly tooling:
ORG_ACME_CALENDLY_PAT=
ORG_ACME_TYPEFORM_API_KEY=
ORG_ACME_TYPEFORM_FORM_IDS=
```

Hyphens in the slug become underscores (`acme-co` → `ORG_ACME_CO_…`).

5. **Redeploy** Vercel (Production env changes require a new deploy). Restart local `npm run api`.
6. In Admin → org → **Refresh status** — webhook secret should show **set**.
7. **Add members** — in Admin → org → Team members, enter email + role (optional password). New emails are created in Supabase Auth automatically; existing Auth users are just added to the org.
7b. **(Optional) Backfill CSV** — Admin → org → Import CSV exports: Typeform → leads, Calendly → bookings, Whop → payments.
8. Point vendor webhooks at the URLs shown for the selected providers, e.g.:
   - Typeform: `POST /api/webhooks/<slug>/forms?source=typeform&secret=…`
   - Calendly: `POST /api/webhooks/<slug>/bookings?source=calendly&secret=…`
   - Whop: `POST /api/webhooks/<slug>/payments?source=whop&secret=…`
   - Fanbasis: `POST /api/webhooks/<slug>/payments?source=fanbasis&secret=…`
   - iClosed (forms and/or bookings): `POST /api/webhooks/<slug>/iclosed?secret=…`
9. Or (Typeform/Calendly only): `ORG_SLUG=<slug> WEBHOOK_SECRET=<that-org-secret> WEBHOOK_BASE_URL=… npm run register-webhooks`
10. Smoke-test Events for that workspace; confirm another org’s user cannot see its data.

### iClosed notes

- Webhooks are plan/beta gated — enable with iClosed support, then paste the org `…/iclosed?secret=…` URL.
- Contact events (all statuses) upsert leads; call booked/cancelled/rescheduled upsert the same booking by call id.
- Outcomes / iClosed transactions are logged as skipped events — **Whop** sets `closed` / `cash_collected`.

### Dooly (seeded org)

Also accepts the legacy globals: `WEBHOOK_SECRET`, `CALENDLY_API_KEY`, `TYPEFORM_API_KEY`, `TYPEFORM_FORM_IDS`.

## Roles (app)

| Role | Access |
|---|---|
| platform_admin | All orgs, admin portal, provider selection |
| org_admin | Full org data, team |
| manager | Dashboards, commissions, matches, events, edit |
| rep | Own bookings (when linked), PCF, performance |
| viewer | Read-only dashboards/tables |

`sales_reps.role` (setter/closer) is a **job title**, not an app permission.

## Secrets model

Secrets are **not** stored in the database. The admin UI only shows whether the matching `ORG_<SLUG>_…` env vars are present on the API process.
