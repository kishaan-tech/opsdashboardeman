-- ============================================================================
-- 0007_sales_stats_fields.sql — raw fields needed to track Overview KPIs
-- (Booked Calls, Recordings, Show-Ups, Now Closed, PIFs, Splits, Cash
-- Contracted / Collected, Closer Cancelled). Rates & $/call are derived in
-- the sales_overview_stats view — never store those.
-- Safe to re-run.
-- ============================================================================

-- Recordings: explicit flag (also backfilled from fathom_link)
alter table public.bookings
  add column if not exists has_recording boolean not null default false;

-- Paid in full (vs deposit / payment plan)
alter table public.bookings
  add column if not exists pif boolean not null default false;

-- Split deal (multiple payers / shared close)
alter table public.bookings
  add column if not exists is_split boolean not null default false;

-- Contracted deal size (may differ from cash actually collected)
alter table public.bookings
  add column if not exists cash_contracted numeric(12,2);

-- Closer-side cancel (distinct from invitee/lead cancel in status)
alter table public.bookings
  add column if not exists closer_cancelled boolean not null default false;

-- Optional payment shape for reporting
alter table public.bookings
  add column if not exists payment_type text;
  -- expected values: 'pif' | 'deposit' | 'split' | null

comment on column public.bookings.has_recording is
  'True when a call recording exists (Fathom or other)';
comment on column public.bookings.pif is
  'Paid in full';
comment on column public.bookings.is_split is
  'Split / shared close';
comment on column public.bookings.cash_contracted is
  'Contracted cash amount (deal size); cash_collected is money received';
comment on column public.bookings.closer_cancelled is
  'Cancelled by closer (feeds Closer Cancelled / % KPIs)';
comment on column public.bookings.payment_type is
  'pif | deposit | split';

-- Backfills from existing data
update public.bookings
set has_recording = true
where coalesce(has_recording, false) = false
  and fathom_link is not null
  and length(trim(fathom_link)) > 0;

update public.bookings
set closer_cancelled = true
where coalesce(closer_cancelled, false) = false
  and lower(coalesce(status, '')) in (
    'canceled', 'cancelled', 'closer cancelled', 'closer canceled'
  );

update public.bookings
set cash_contracted = revenue_generated
where cash_contracted is null
  and revenue_generated is not null;

update public.bookings
set pif = true,
    payment_type = coalesce(payment_type, 'pif')
where coalesce(pif, false) = false
  and cash_collected is not null
  and cash_contracted is not null
  and cash_collected >= cash_contracted
  and cash_contracted > 0;

update public.bookings
set payment_type = 'split'
where is_split = true
  and payment_type is null;

-- Live Overview KPIs (filter by start_time in the app / a date CTE as needed)
create or replace view public.sales_overview_stats
  with (security_invoker = true) as
select
  count(*) filter (
    where start_time is not null
      and coalesce(closer_cancelled, false) = false
      and lower(coalesce(status, '')) not in ('canceled', 'cancelled')
  )                                                                   as booked_calls,
  count(*) filter (
    where has_recording
       or (fathom_link is not null and length(trim(fathom_link)) > 0)
  )                                                                   as recordings,
  count(*) filter (where showed_up)                                   as show_ups,
  count(*) filter (where closed)                                      as now_closed,
  count(*) filter (where pif)                                         as pifs,
  count(*) filter (where is_split)                                    as splits_count,
  coalesce(sum(cash_contracted), 0)                                   as cash_contracted,
  coalesce(sum(cash_collected), 0)                                    as new_cash_collected,
  count(*) filter (where closer_cancelled)                            as closer_cancelled,
  round(
    100.0 * count(*) filter (where closer_cancelled)
      / nullif(count(*) filter (where start_time is not null), 0)
  , 1)                                                                as closer_cancelled_pct,
  -- Show-up rate: shows / past non-canceled bookings (excl. future)
  round(
    100.0 * count(*) filter (where showed_up)
      / nullif(
        count(*) filter (
          where start_time is not null
            and start_time < now()
            and coalesce(closer_cancelled, false) = false
            and lower(coalesce(status, '')) not in ('canceled', 'cancelled')
        ), 0)
  , 1)                                                                as show_up_rate,
  -- Book to close %: closes / booked (non-canceled)
  round(
    100.0 * count(*) filter (where closed)
      / nullif(
        count(*) filter (
          where start_time is not null
            and coalesce(closer_cancelled, false) = false
            and lower(coalesce(status, '')) not in ('canceled', 'cancelled')
        ), 0)
  , 1)                                                                as book_to_close_pct,
  round(
    coalesce(sum(cash_collected), 0)
      / nullif(
        count(*) filter (
          where start_time is not null
            and coalesce(closer_cancelled, false) = false
            and lower(coalesce(status, '')) not in ('canceled', 'cancelled')
        ), 0)
  , 0)                                                                as cash_per_booked_call,
  -- "Appt" = showed up
  round(
    coalesce(sum(cash_collected), 0)
      / nullif(count(*) filter (where showed_up), 0)
  , 0)                                                                as cash_per_appt,
  round(
    coalesce(sum(cash_contracted), 0)
      / nullif(count(*) filter (where showed_up), 0)
  , 0)                                                                as cash_contracted_per_appt
from public.bookings;

comment on view public.sales_overview_stats is
  'Overview KPI rollup matching the sales dashboard (counts + derived rates)';
