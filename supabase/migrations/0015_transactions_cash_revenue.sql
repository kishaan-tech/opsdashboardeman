-- Per-payment cash / revenue snapshots (mirrors booking attribution rules).
alter table public.transactions
  add column if not exists cash_collected numeric(12,2),
  add column if not exists revenue_generated numeric(12,2);

comment on column public.transactions.cash_collected is
  'Money taken on this payment (close cash for the charge)';
comment on column public.transactions.revenue_generated is
  'Deal / subscription total for this payment (plan price when sub/renewal, else cash)';

-- Backfill cash from amount; revenue from linked booking when higher, else amount.
update public.transactions t
set cash_collected = coalesce(t.cash_collected, t.amount)
where t.cash_collected is null
  and t.amount is not null;

update public.transactions t
set revenue_generated = coalesce(
  t.revenue_generated,
  greatest(coalesce(b.revenue_generated, 0), coalesce(t.amount, 0)),
  t.amount
)
from public.bookings b
where t.booking_id = b.id
  and t.revenue_generated is null;

update public.transactions t
set revenue_generated = coalesce(t.revenue_generated, t.amount)
where t.revenue_generated is null
  and t.amount is not null;
