-- Multi-select providers per channel (clients may run several tools in parallel).

alter table public.organizations
  add column if not exists forms_providers text[] not null default array['typeform']::text[],
  add column if not exists bookings_providers text[] not null default array['calendly']::text[],
  add column if not exists payments_providers text[] not null default array['whop']::text[];

-- Backfill from legacy singular columns when present
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'forms_provider'
  ) then
    update public.organizations
    set forms_providers = array[forms_provider]
    where forms_provider is not null;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'bookings_provider'
  ) then
    update public.organizations
    set bookings_providers = array[bookings_provider]
    where bookings_provider is not null;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'payments_provider'
  ) then
    update public.organizations
    set payments_providers = array[payments_provider]
    where payments_provider is not null;
  end if;
end $$;

alter table public.organizations drop constraint if exists organizations_forms_provider_check;
alter table public.organizations drop constraint if exists organizations_bookings_provider_check;
alter table public.organizations drop constraint if exists organizations_payments_provider_check;

alter table public.organizations drop column if exists forms_provider;
alter table public.organizations drop column if exists bookings_provider;
alter table public.organizations drop column if exists payments_provider;

alter table public.organizations drop constraint if exists organizations_forms_providers_check;
alter table public.organizations drop constraint if exists organizations_bookings_providers_check;
alter table public.organizations drop constraint if exists organizations_payments_providers_check;

alter table public.organizations
  add constraint organizations_forms_providers_check
    check (
      cardinality(forms_providers) >= 1
      and forms_providers <@ array['typeform','iclosed']::text[]
    ),
  add constraint organizations_bookings_providers_check
    check (
      cardinality(bookings_providers) >= 1
      and bookings_providers <@ array['calendly','iclosed']::text[]
    ),
  add constraint organizations_payments_providers_check
    check (
      cardinality(payments_providers) >= 1
      and payments_providers <@ array['whop','fanbasis']::text[]
    );

comment on column public.organizations.forms_providers is 'Opt-in webhook vendors (multi): typeform, iclosed';
comment on column public.organizations.bookings_providers is 'Booking webhook vendors (multi): calendly, iclosed';
comment on column public.organizations.payments_providers is 'Payment webhook vendors (multi): whop, fanbasis — each may close/cash';
