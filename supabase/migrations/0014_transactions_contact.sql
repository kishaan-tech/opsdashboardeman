-- Denormalized payer contact on transactions (Whop/Fanbasis/CSV imports).
alter table public.transactions
  add column if not exists email text,
  add column if not exists lead_name text;

create index if not exists transactions_email_idx
  on public.transactions (org_id, lower(email))
  where email is not null;

comment on column public.transactions.email is 'Payer email from payment vendor / CSV';
comment on column public.transactions.lead_name is 'Payer display name from payment vendor / CSV';

-- Backfill from linked booking contact fields when present.
update public.transactions t
set
  email = coalesce(t.email, nullif(lower(b.email), '')),
  lead_name = coalesce(t.lead_name, nullif(b.lead_name, ''))
from public.bookings b
where t.booking_id = b.id
  and (t.email is null or t.lead_name is null);
