-- Allow GHL, custom forms, and WebinarJam as lead-capture (forms) providers.
alter table public.organizations
  drop constraint if exists organizations_forms_providers_check;

alter table public.organizations
  add constraint organizations_forms_providers_check
  check (
      cardinality(forms_providers) >= 1
      and forms_providers <@ array['typeform','iclosed','ghl','custom','webinarjam']::text[]
  );

comment on column public.organizations.forms_providers is
  'Opt-in webhook vendors (multi): typeform, iclosed, ghl, custom, webinarjam';
