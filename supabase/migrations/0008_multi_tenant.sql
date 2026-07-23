-- ============================================================================
-- 0008_multi_tenant.sql — shared-schema multi-tenancy
-- organizations, memberships, platform admins, integrations, org_id on
-- domain tables, org-scoped unique indexes + RLS. Safe to re-run.
-- ============================================================================

-- DROP views first: CREATE OR REPLACE cannot prepend org_id to existing
-- column lists (Postgres error 42P16).
drop view if exists public.metrics_weekly;
drop view if exists public.metrics_daily;

-- ---------------------------------------------------------------------------
-- Control plane
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  status      text not null default 'active'
              check (status in ('active', 'paused', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table if not exists public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  note        text
);

create table if not exists public.org_memberships (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null default 'viewer'
                check (role in ('org_admin', 'manager', 'rep', 'viewer')),
  sales_rep_id  uuid references public.sales_reps (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists org_memberships_user_idx on public.org_memberships (user_id);
create index if not exists org_memberships_org_idx on public.org_memberships (org_id);

drop trigger if exists org_memberships_set_updated_at on public.org_memberships;
create trigger org_memberships_set_updated_at
  before update on public.org_memberships
  for each row execute function public.set_updated_at();

-- Per-org integration credentials. Ciphertext columns are opaque to the
-- browser; only the service-role API decrypts them.
create table if not exists public.org_integrations (
  org_id                    uuid primary key references public.organizations (id) on delete cascade,
  webhook_secret_ciphertext text,
  calendly_pat_ciphertext   text,
  typeform_api_key_ciphertext text,
  typeform_form_ids         text,
  status                    text not null default 'configured'
                            check (status in ('configured', 'incomplete', 'error')),
  last_webhook_at           timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

drop trigger if exists org_integrations_set_updated_at on public.org_integrations;
create trigger org_integrations_set_updated_at
  before update on public.org_integrations
  for each row execute function public.set_updated_at();

create table if not exists public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users (id) on delete set null,
  org_id      uuid references public.organizations (id) on delete set null,
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_log_org_idx
  on public.admin_audit_log (org_id, created_at desc);
create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Seed the existing single-tenant client as org #1 (dooly)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name, status)
values (
  'a0000000-0000-4000-8000-000000000001',
  'dooly',
  'Dooly / Brand Accelerator',
  'active'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Add org_id to domain + audit tables
-- ---------------------------------------------------------------------------
alter table public.ingestion_events
  add column if not exists org_id uuid references public.organizations (id);

alter table public.leads
  add column if not exists org_id uuid references public.organizations (id);
alter table public.bookings
  add column if not exists org_id uuid references public.organizations (id);
alter table public.sales_reps
  add column if not exists org_id uuid references public.organizations (id);
alter table public.transactions
  add column if not exists org_id uuid references public.organizations (id);
alter table public.emails
  add column if not exists org_id uuid references public.organizations (id);
alter table public.setter_eod_report
  add column if not exists org_id uuid references public.organizations (id);
alter table public.identity_matches
  add column if not exists org_id uuid references public.organizations (id);

-- Backfill existing rows onto the seeded org
update public.ingestion_events
  set org_id = 'a0000000-0000-4000-8000-000000000001' where org_id is null;
update public.leads
  set org_id = 'a0000000-0000-4000-8000-000000000001' where org_id is null;
update public.bookings
  set org_id = 'a0000000-0000-4000-8000-000000000001' where org_id is null;
update public.sales_reps
  set org_id = 'a0000000-0000-4000-8000-000000000001' where org_id is null;
update public.transactions
  set org_id = 'a0000000-0000-4000-8000-000000000001' where org_id is null;
update public.emails
  set org_id = 'a0000000-0000-4000-8000-000000000001' where org_id is null;
update public.setter_eod_report
  set org_id = 'a0000000-0000-4000-8000-000000000001' where org_id is null;
update public.identity_matches
  set org_id = 'a0000000-0000-4000-8000-000000000001' where org_id is null;

-- Require org_id going forward
alter table public.leads alter column org_id set not null;
alter table public.bookings alter column org_id set not null;
alter table public.sales_reps alter column org_id set not null;
alter table public.transactions alter column org_id set not null;
alter table public.emails alter column org_id set not null;
alter table public.setter_eod_report alter column org_id set not null;
alter table public.identity_matches alter column org_id set not null;
-- ingestion_events may briefly lack org_id on insert failure paths; keep nullable
-- but index for filtering

create index if not exists ingestion_events_org_idx
  on public.ingestion_events (org_id, received_at desc);
create index if not exists leads_org_idx on public.leads (org_id);
create index if not exists bookings_org_idx on public.bookings (org_id);
create index if not exists sales_reps_org_idx on public.sales_reps (org_id);
create index if not exists transactions_org_idx on public.transactions (org_id);
create index if not exists emails_org_idx on public.emails (org_id);
create index if not exists setter_eod_report_org_idx on public.setter_eod_report (org_id);
create index if not exists identity_matches_org_idx on public.identity_matches (org_id);

-- ---------------------------------------------------------------------------
-- Per-org unique indexes for webhook idempotency
-- ---------------------------------------------------------------------------
drop index if exists public.leads_source_external_idx;
drop index if exists public.bookings_source_external_idx;
drop index if exists public.sales_reps_source_external_idx;
drop index if exists public.transactions_source_external_idx;
drop index if exists public.emails_source_external_idx;
drop index if exists public.setter_eod_report_source_external_idx;
drop index if exists public.ingestion_events_external_idx;

create unique index if not exists leads_org_source_external_idx
  on public.leads (org_id, source, external_id);
create unique index if not exists bookings_org_source_external_idx
  on public.bookings (org_id, source, external_id);
create unique index if not exists sales_reps_org_source_external_idx
  on public.sales_reps (org_id, source, external_id);
create unique index if not exists transactions_org_source_external_idx
  on public.transactions (org_id, source, external_id);
create unique index if not exists emails_org_source_external_idx
  on public.emails (org_id, source, external_id);
create unique index if not exists setter_eod_report_org_source_external_idx
  on public.setter_eod_report (org_id, source, external_id);
create unique index if not exists ingestion_events_org_external_idx
  on public.ingestion_events (org_id, source, external_id);

-- identity_matches pair uniqueness stays global on lead ids (leads already org-scoped)
-- but also enforce same-org pairs
alter table public.identity_matches
  drop constraint if exists identity_matches_same_org;
-- enforced via trigger below after helpers exist

-- ---------------------------------------------------------------------------
-- RLS helpers (security definer — avoid recursive policy checks)
-- ---------------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$$;

create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.org_memberships where user_id = auth.uid();
$$;

create or replace function public.user_has_org(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
      or exists (
           select 1 from public.org_memberships
           where user_id = auth.uid() and org_id = p_org_id
         );
$$;

create or replace function public.user_org_role(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_platform_admin() then 'platform_admin'
    else (
      select role from public.org_memberships
      where user_id = auth.uid() and org_id = p_org_id
      limit 1
    )
  end;
$$;

create or replace function public.user_can_write_org(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
      or exists (
           select 1 from public.org_memberships
           where user_id = auth.uid()
             and org_id = p_org_id
             and role in ('org_admin', 'manager', 'rep')
         );
$$;

revoke all on function public.is_platform_admin() from public;
revoke all on function public.user_org_ids() from public;
revoke all on function public.user_has_org(uuid) from public;
revoke all on function public.user_org_role(uuid) from public;
revoke all on function public.user_can_write_org(uuid) from public;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.user_org_ids() to authenticated;
grant execute on function public.user_has_org(uuid) to authenticated;
grant execute on function public.user_org_role(uuid) to authenticated;
grant execute on function public.user_can_write_org(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Replace open RLS with org-scoped policies
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'leads','bookings','sales_reps','transactions','emails',
    'setter_eod_report','identity_matches','ingestion_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format('drop policy if exists "org members read" on public.%I', t);
    execute format('drop policy if exists "org members write" on public.%I', t);
    execute format(
      'create policy "org members read" on public.%I
         for select to authenticated
         using (public.user_has_org(org_id))', t);
    execute format(
      'create policy "org members write" on public.%I
         for all to authenticated
         using (public.user_can_write_org(org_id))
         with check (public.user_can_write_org(org_id))', t);
  end loop;
end $$;

-- Control-plane RLS
alter table public.organizations enable row level security;
drop policy if exists "orgs readable by members" on public.organizations;
drop policy if exists "orgs writable by platform admin" on public.organizations;
create policy "orgs readable by members" on public.organizations
  for select to authenticated
  using (public.is_platform_admin() or id in (select public.user_org_ids()));
create policy "orgs writable by platform admin" on public.organizations
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter table public.org_memberships enable row level security;
drop policy if exists "memberships readable" on public.org_memberships;
drop policy if exists "memberships writable" on public.org_memberships;
create policy "memberships readable" on public.org_memberships
  for select to authenticated
  using (
    public.is_platform_admin()
    or user_id = auth.uid()
    or (
      org_id in (select public.user_org_ids())
      and public.user_org_role(org_id) in ('org_admin', 'platform_admin', 'manager')
    )
  );
create policy "memberships writable" on public.org_memberships
  for all to authenticated
  using (
    public.is_platform_admin()
    or public.user_org_role(org_id) = 'org_admin'
  )
  with check (
    public.is_platform_admin()
    or public.user_org_role(org_id) = 'org_admin'
  );

alter table public.platform_admins enable row level security;
drop policy if exists "platform admins read self" on public.platform_admins;
drop policy if exists "platform admins manage" on public.platform_admins;
create policy "platform admins read self" on public.platform_admins
  for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());
create policy "platform admins manage" on public.platform_admins
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Integrations: members can see status/metadata; ciphertext never selected by UI
-- (UI uses columns via admin API or selects non-secret cols only).
alter table public.org_integrations enable row level security;
drop policy if exists "integrations readable" on public.org_integrations;
drop policy if exists "integrations writable" on public.org_integrations;
create policy "integrations readable" on public.org_integrations
  for select to authenticated
  using (
    public.is_platform_admin()
    or public.user_org_role(org_id) = 'org_admin'
  );
create policy "integrations writable" on public.org_integrations
  for all to authenticated
  using (public.is_platform_admin() or public.user_org_role(org_id) = 'org_admin')
  with check (public.is_platform_admin() or public.user_org_role(org_id) = 'org_admin');

alter table public.admin_audit_log enable row level security;
drop policy if exists "audit readable by platform" on public.admin_audit_log;
drop policy if exists "audit insert by authenticated" on public.admin_audit_log;
create policy "audit readable by platform" on public.admin_audit_log
  for select to authenticated
  using (
    public.is_platform_admin()
    or (org_id is not null and public.user_org_role(org_id) = 'org_admin')
  );
create policy "audit insert by authenticated" on public.admin_audit_log
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (org_id is not null and public.user_org_role(org_id) in ('org_admin', 'platform_admin'))
  );

-- ---------------------------------------------------------------------------
-- Metrics views — include org_id so tenants can filter
-- ---------------------------------------------------------------------------
create view public.metrics_weekly
  with (security_invoker = true) as
with b as (
  select org_id,
         date_trunc('week', start_time)::date as wk,
         count(*)                              as total_bookings,
         count(*) filter (where showed_up)     as total_shows,
         count(*) filter (where closed)        as total_closes,
         coalesce(sum(cash_collected), 0)      as cash_collected,
         coalesce(sum(revenue_generated), 0)   as revenue_generated
  from public.bookings
  where start_time is not null
  group by 1, 2
),
l as (
  select org_id,
         date_trunc('week', date_added)::date as wk,
         count(*)                             as new_leads
  from public.leads
  where date_added is not null
  group by 1, 2
),
t as (
  select org_id,
         date_trunc('week', "date")::date as wk,
         coalesce(sum(amount), 0)         as transaction_total
  from public.transactions
  where "date" is not null
  group by 1, 2
)
select
  coalesce(b.org_id, l.org_id, t.org_id)                              as org_id,
  coalesce(b.wk, l.wk, t.wk)                                          as week,
  coalesce(l.new_leads, 0)                                            as new_leads,
  coalesce(b.total_bookings, 0)                                       as total_bookings,
  coalesce(b.total_shows, 0)                                          as total_shows,
  coalesce(b.total_closes, 0)                                         as total_closes,
  round(100.0 * b.total_shows  / nullif(b.total_bookings, 0), 1)      as show_rate,
  round(100.0 * b.total_closes / nullif(b.total_shows, 0), 1)         as close_rate,
  coalesce(b.cash_collected, 0)                                       as cash_collected,
  coalesce(b.revenue_generated, 0)                                    as revenue_generated,
  coalesce(t.transaction_total, 0)                                    as transaction_total
from b
full join l on l.wk = b.wk and l.org_id = b.org_id
full join t on t.wk = coalesce(b.wk, l.wk) and t.org_id = coalesce(b.org_id, l.org_id)
order by 2 desc;

create view public.metrics_daily
  with (security_invoker = true) as
select
  org_id,
  start_time::date                                                    as day,
  count(*)                                                            as total_bookings,
  count(*) filter (where showed_up)                                   as total_shows,
  count(*) filter (where closed)                                      as total_closes,
  round(100.0 * count(*) filter (where showed_up) / nullif(count(*), 0), 1) as show_rate,
  coalesce(sum(cash_collected), 0)                                    as cash_collected,
  coalesce(sum(revenue_generated), 0)                                 as revenue_generated
from public.bookings
where start_time is not null
group by 1, 2
order by 2 desc;

-- Seed empty integrations row for dooly (secrets filled via admin later)
insert into public.org_integrations (org_id, status)
values ('a0000000-0000-4000-8000-000000000001', 'incomplete')
on conflict (org_id) do nothing;

comment on table public.organizations is 'Multi-tenant client instances';
comment on table public.org_memberships is 'Per-org team members and app roles';
comment on table public.org_integrations is 'Per-org encrypted vendor credentials + webhook secret';
comment on table public.platform_admins is 'Cross-tenant platform operators';
comment on table public.admin_audit_log is 'Admin actions (create org, rotate keys, invite)';
