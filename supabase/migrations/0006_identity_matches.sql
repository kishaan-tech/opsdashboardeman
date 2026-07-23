-- ============================================================================
-- 0006_identity_matches.sql — flag leads that look like the same person across
-- different emails (shared phone and/or name). Safe to re-run.
-- ============================================================================

alter table public.leads
  add column if not exists possible_duplicate boolean not null default false;

create table if not exists public.identity_matches (
  id            uuid primary key default gen_random_uuid(),
  lead_a_id     uuid not null references public.leads (id) on delete cascade,
  lead_b_id     uuid not null references public.leads (id) on delete cascade,
  match_on      text[] not null default '{}',
  confidence    text not null default 'medium'
                check (confidence in ('high', 'medium', 'low')),
  status        text not null default 'open'
                check (status in ('open', 'confirmed', 'dismissed')),
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (lead_a_id <> lead_b_id),
  check (lead_a_id < lead_b_id)
);

create unique index if not exists identity_matches_pair_uidx
  on public.identity_matches (lead_a_id, lead_b_id);

create index if not exists identity_matches_status_idx
  on public.identity_matches (status, confidence, created_at desc);

create index if not exists identity_matches_lead_a_idx on public.identity_matches (lead_a_id);
create index if not exists identity_matches_lead_b_idx on public.identity_matches (lead_b_id);

drop trigger if exists identity_matches_set_updated_at on public.identity_matches;
create trigger identity_matches_set_updated_at
  before update on public.identity_matches
  for each row execute function public.set_updated_at();

alter table public.identity_matches enable row level security;
drop policy if exists "authenticated full access" on public.identity_matches;
create policy "authenticated full access" on public.identity_matches
  for all to authenticated using (true) with check (true);

comment on table public.identity_matches is
  'Possible same-person pairs across different emails (matched on phone/name)';
comment on column public.leads.possible_duplicate is
  'True when this lead has at least one open identity_matches row';

-- Keep leads.possible_duplicate in sync with open matches
create or replace function public.refresh_lead_duplicate_flags(p_lead_ids uuid[])
returns void language plpgsql as $$
begin
  update public.leads l
  set possible_duplicate = exists (
    select 1 from public.identity_matches m
    where m.status = 'open'
      and (m.lead_a_id = l.id or m.lead_b_id = l.id)
  )
  where l.id = any(p_lead_ids);
end $$;
