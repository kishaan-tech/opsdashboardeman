-- ============================================================================
-- 0003_metrics_views.sql — live replacement for the Airtable "Metrics" table.
--
-- In Airtable, Metrics was a table of rollups/formulas that had to be linked
-- to every booking/lead/transaction to work. Here it's computed straight from
-- the source tables, so it can never drift and needs no plumbing.
-- security_invoker makes the views respect the querying user's RLS.
-- ============================================================================

create or replace view public.metrics_weekly
  with (security_invoker = true) as
with b as (
  select date_trunc('week', start_time)::date as wk,
         count(*)                              as total_bookings,
         count(*) filter (where showed_up)     as total_shows,
         count(*) filter (where closed)        as total_closes,
         coalesce(sum(cash_collected), 0)      as cash_collected,
         coalesce(sum(revenue_generated), 0)   as revenue_generated
  from public.bookings
  where start_time is not null
  group by 1
),
l as (
  select date_trunc('week', date_added)::date as wk,
         count(*)                             as new_leads
  from public.leads
  where date_added is not null
  group by 1
),
t as (
  select date_trunc('week', "date")::date as wk,
         coalesce(sum(amount), 0)         as transaction_total
  from public.transactions
  where "date" is not null
  group by 1
)
select
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
full join l on l.wk = b.wk
full join t on t.wk = coalesce(b.wk, l.wk)
order by 1 desc;

create or replace view public.metrics_daily
  with (security_invoker = true) as
select
  start_time::date                                                    as day,
  count(*)                                                            as total_bookings,
  count(*) filter (where showed_up)                                   as total_shows,
  count(*) filter (where closed)                                      as total_closes,
  round(100.0 * count(*) filter (where showed_up) / nullif(count(*), 0), 1) as show_rate,
  coalesce(sum(cash_collected), 0)                                    as cash_collected,
  coalesce(sum(revenue_generated), 0)                                 as revenue_generated
from public.bookings
where start_time is not null
group by 1
order by 1 desc;
