-- ============================================================================
-- 0001_core.sql — infrastructure shared by every schema
-- Apply this BEFORE the generated schema migration.
-- ============================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping: every domain table attaches this trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Ingestion audit log: every inbound event (form, booking, payment webhook)
-- lands here first, then gets marked processed/failed. This is the debugging
-- surface that replaces guessing at Zapier task history.
-- ---------------------------------------------------------------------------
create table if not exists public.ingestion_events (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,                 -- e.g. 'typeform', 'calendly', 'stripe'
  event_type   text not null,                 -- e.g. 'form.submitted', 'booking.created'
  external_id  text,                          -- sender's event/delivery id, for replay detection
  payload      jsonb not null,
  status       text not null default 'received'
               check (status in ('received', 'processed', 'failed', 'skipped')),
  error        text,                          -- populated when status = 'failed'
  record_table text,                          -- which table the event wrote to
  record_id    uuid,                          -- and which row
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists ingestion_events_status_idx   on public.ingestion_events (status, received_at desc);
create index if not exists ingestion_events_source_idx   on public.ingestion_events (source, received_at desc);
-- replayed webhook deliveries are detectable per source
create unique index if not exists ingestion_events_external_idx
  on public.ingestion_events (source, external_id) where external_id is not null;

alter table public.ingestion_events enable row level security;

-- Internal single-operator tool: any authenticated user has full access.
-- The ingestion API uses the service-role key, which bypasses RLS entirely.
drop policy if exists "authenticated full access" on public.ingestion_events;
create policy "authenticated full access" on public.ingestion_events
  for all to authenticated using (true) with check (true);
