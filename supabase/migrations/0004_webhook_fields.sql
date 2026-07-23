-- ============================================================================
-- 0004_webhook_fields.sql — columns the Typeform / Calendly / Whop pipeline needs.
-- Safe to re-run (IF NOT EXISTS).
-- ============================================================================

-- Typeform answers shown on the Leads table / detail panel
alter table public.leads
  add column if not exists form_answers jsonb;

alter table public.leads
  add column if not exists form_response_url text;

-- Calendly tracking.* for setter / closer attribution
alter table public.bookings
  add column if not exists utm jsonb;

comment on column public.leads.form_answers is
  'Latest Typeform (or other form) answers keyed by question title';
comment on column public.leads.form_response_url is
  'Vendor deep-link to the raw form response, when available';
comment on column public.bookings.utm is
  'Calendly tracking UTMs: utm_source/content → set_by, utm_campaign → closer';
