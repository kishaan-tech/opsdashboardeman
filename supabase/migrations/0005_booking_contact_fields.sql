-- ============================================================================
-- 0005_booking_contact_fields.sql — denormalized contact on bookings so the
-- table shows lead_name / email / phone like leads (bidirectional with lead_id).
-- Safe to re-run.
-- ============================================================================

alter table public.bookings
  add column if not exists lead_name text;

alter table public.bookings
  add column if not exists email text;

alter table public.bookings
  add column if not exists phone text;

comment on column public.bookings.lead_name is
  'Invitee / lead display name (kept in sync with leads.lead_name)';
comment on column public.bookings.email is
  'Invitee / lead email (kept in sync with leads.email; email_calendly is vendor provenance)';
comment on column public.bookings.phone is
  'Invitee / lead phone (kept in sync with leads.phone)';

-- Backfill from linked leads + legacy email_calendly
update public.bookings b
set
  email     = coalesce(b.email, b.email_calendly, l.email),
  lead_name = coalesce(b.lead_name, l.lead_name),
  phone     = coalesce(b.phone, l.phone)
from public.leads l
where b.lead_id = l.id
  and (
    b.email is null
    or b.lead_name is null
    or b.phone is null
  );

-- Bookings with email_calendly but no lead_id still get an email
update public.bookings
set email = coalesce(email, email_calendly)
where email is null and email_calendly is not null;
