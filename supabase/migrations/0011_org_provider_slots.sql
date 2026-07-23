-- Per-org mix-and-match integration providers (platform admin configures).
alter table public.organizations
  add column if not exists forms_provider text not null default 'typeform'
    check (forms_provider in ('typeform', 'iclosed')),
  add column if not exists bookings_provider text not null default 'calendly'
    check (bookings_provider in ('calendly', 'iclosed')),
  add column if not exists payments_provider text not null default 'whop'
    check (payments_provider in ('whop'));

comment on column public.organizations.forms_provider is 'Opt-in webhook vendor: typeform | iclosed';
comment on column public.organizations.bookings_provider is 'Booking webhook vendor: calendly | iclosed';
comment on column public.organizations.payments_provider is 'Payment webhook vendor: whop (cash/closed source of truth)';
