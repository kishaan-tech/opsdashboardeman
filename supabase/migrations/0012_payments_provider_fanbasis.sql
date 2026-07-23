-- Allow Fanbasis as an alternate payments processor (alongside Whop).
alter table public.organizations
  drop constraint if exists organizations_payments_provider_check;

alter table public.organizations
  add constraint organizations_payments_provider_check
  check (payments_provider in ('whop', 'fanbasis'));

comment on column public.organizations.payments_provider is
  'Payment webhook vendor: whop | fanbasis (selected provider owns closed/cash_collected)';
