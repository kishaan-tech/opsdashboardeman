/**
 * End-to-end smoke test: iClosed → ops-hub for org emanfba (Eman / Emmanuel).
 *
 * Usage:
 *   node tools/smoke-iclosed-eman.js
 *   SMOKE_BASE_URL=https://opsdashboarddooly.vercel.app node tools/smoke-iclosed-eman.js
 *
 * Checks:
 *  1. Env secrets present (webhook + API key)
 *  2. iClosed public API auth (Bearer)
 *  3. Webhook auth (401 / 503)
 *  4. Contact created → lead in emanfba
 *  5. Call booked → booking + setter/closer hints resolved when reps exist
 *  6. Reschedule updates same booking row
 *  7. Cancel sets status Canceled
 *  8. Outcome skipped (Whop owns cash/closed)
 *  9. Org isolation (rows tagged emanfba org_id only)
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const SLUG = process.env.SMOKE_ORG_SLUG || 'emanfba';
const BASE = (process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 8787}`).replace(/\/$/, '');
const ORG_PREFIX = `ORG_${SLUG.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
const WEBHOOK_SECRET = (process.env[`${ORG_PREFIX}_WEBHOOK_SECRET`] || '').trim();
const ICLOSED_API_KEY = (process.env[`${ORG_PREFIX}_ICLOSED_API_KEY`] || '').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const RUN = `smoke-${Date.now().toString(36)}`;
const CONTACT_EMAIL = `${RUN}@example.com`;
const CALL_ID = `call_${RUN}`;

let failed = 0;
function ok(label, detail = '') {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail = '') {
  failed += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n== ${title} ==`);
}

function loadFixture(name) {
  return JSON.parse(
    readFileSync(path.join(root, 'server/src/lib/vendors/fixtures/iclosed', name), 'utf8'),
  );
}

async function postIclosed(body, { secret = WEBHOOK_SECRET } = {}) {
  const url = secret
    ? `${BASE}/api/webhooks/${SLUG}/iclosed?secret=${encodeURIComponent(secret)}`
    : `${BASE}/api/webhooks/${SLUG}/iclosed`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  console.log(`iClosed smoke → ${BASE} / org=${SLUG} / run=${RUN}`);

  section('1. Env');
  if (!WEBHOOK_SECRET) fail('ORG_*_WEBHOOK_SECRET missing');
  else ok('webhook secret', `${ORG_PREFIX}_WEBHOOK_SECRET (${WEBHOOK_SECRET.length} chars)`);
  if (!ICLOSED_API_KEY) fail('ORG_*_ICLOSED_API_KEY missing');
  else if (!ICLOSED_API_KEY.startsWith('iclosed_')) fail('API key must start with iclosed_');
  else ok('iclosed api key', `${ICLOSED_API_KEY.length} chars`);
  if (!SUPABASE_URL || !SERVICE_KEY) fail('Supabase URL / service role missing');
  else ok('supabase service role configured');

  if (!WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('\nAborting — fix env first.');
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: org, error: orgErr } = await sb
    .from('organizations')
    .select('id, slug, forms_providers, bookings_providers, payments_providers, status')
    .eq('slug', SLUG)
    .maybeSingle();
  if (orgErr || !org) {
    fail('org lookup', orgErr?.message || 'not found');
    process.exit(1);
  }
  ok('org', `${org.name || org.slug} forms=${(org.forms_providers || []).join('+')} bookings=${(org.bookings_providers || []).join('+')}`);
  if (!(org.forms_providers || []).includes('iclosed') || !(org.bookings_providers || []).includes('iclosed')) {
    fail('providers should include iclosed for forms+bookings');
  }

  section('2. iClosed public API');
  if (ICLOSED_API_KEY) {
    try {
      const apiRes = await fetch('https://public.api.iclosed.io/v1/eventCalls?eventType=UPCOMING&limit=1', {
        headers: {
          Authorization: `Bearer ${ICLOSED_API_KEY}`,
          Accept: 'application/json',
        },
      });
      const apiBody = await apiRes.json().catch(() => ({}));
      if (apiRes.ok) ok('API auth', `HTTP ${apiRes.status}`);
      else if (apiRes.status === 401) fail('API auth rejected', JSON.stringify(apiBody).slice(0, 160));
      else ok('API reachable', `HTTP ${apiRes.status} ${JSON.stringify(apiBody).slice(0, 120)}`);
    } catch (err) {
      fail('API request error', String(err.message || err));
    }
  }

  section('3. Webhook auth');
  {
    const bad = await postIclosed({ hookType: 'Contact created', email: 'x@y.com' }, { secret: 'wrong' });
    if (bad.status === 401) ok('rejects bad secret', String(bad.status));
    else fail('expected 401 for bad secret', `${bad.status} ${JSON.stringify(bad.json)}`);
  }

  // Seed reps so setter/closer resolution can match official fixture emails
  section('4. Seed sales reps (for setter/closer resolve)');
  const reps = [
    { org_id: org.id, rep_name: 'Riley Chen', email: 'riley.chen@example.com', role: 'setter', source: 'smoke', external_id: `${RUN}-setter` },
    { org_id: org.id, rep_name: 'Jamie Alvarez', email: 'jamie.alvarez@example.com', role: 'closer', source: 'smoke', external_id: `${RUN}-closer` },
  ];
  const { data: upsertedReps, error: repErr } = await sb
    .from('sales_reps')
    .upsert(reps, { onConflict: 'org_id,source,external_id' })
    .select('id, email, rep_name');
  if (repErr) fail('seed reps', repErr.message);
  else ok('seeded reps', upsertedReps.map((r) => r.email).join(', '));

  section('5. Contact created → lead');
  const contact = loadFixture('contact-created.official.json');
  contact.email = CONTACT_EMAIL;
  contact.previewId = `contact_${RUN}`;
  contact.previewUrl = `https://app.iclosed.io/app/global-data/contacts?preview=contact_${RUN}`;
  contact.updatedAt = new Date().toISOString();
  contact.firstName = 'Morgan';
  contact.lastName = 'Lee';
  const cRes = await postIclosed(contact);
  if (cRes.status === 200 && cRes.json.ok) ok('contact webhook', `lead=${cRes.json.id}`);
  else fail('contact webhook', `${cRes.status} ${JSON.stringify(cRes.json)}`);

  const { data: lead } = await sb
    .from('leads')
    .select('id, email, lead_name, phone, source_2, form_answers, form_response_url, org_id')
    .eq('org_id', org.id)
    .ilike('email', CONTACT_EMAIL)
    .maybeSingle();
  if (!lead) fail('lead row missing');
  else {
    ok('lead email/org', lead.email);
    if (lead.org_id !== org.id) fail('lead org_id mismatch');
    if (!/iclosed/i.test(lead.source_2 || '')) fail('source_2 should mention iclosed', lead.source_2);
    else ok('source_2', lead.source_2);
    if (!lead.form_response_url) fail('form_response_url missing');
    else ok('form_response_url set');
    if (!lead.phone) fail('phone missing');
    else ok('phone', lead.phone);
  }

  section('6. Call booked → booking');
  const booked = loadFixture('call-booked.official.json');
  booked.invitee.email = CONTACT_EMAIL;
  booked.invitee.first_name = 'Morgan';
  booked.invitee.last_name = 'Lee';
  booked.invitee.name = 'Morgan Lee';
  booked.invitee.callPreviewId = CALL_ID;
  booked.event.callPreviewId = CALL_ID;
  booked.event.uuid = Number(String(Date.now()).slice(-6));
  booked.event.canceled = false;
  const bRes = await postIclosed(booked);
  if (bRes.status === 200 && bRes.json.ok) ok('call booked webhook', `booking=${bRes.json.id}`);
  else fail('call booked webhook', `${bRes.status} ${JSON.stringify(bRes.json)}`);

  const { data: booking } = await sb
    .from('bookings')
    .select('id, org_id, source, external_id, booking_id, start_time, status, email, lead_name, set_by_id, closer_id, utm, lead_id')
    .eq('org_id', org.id)
    .eq('source', 'iclosed')
    .eq('external_id', CALL_ID)
    .maybeSingle();
  if (!booking) fail('booking row missing');
  else {
    ok('booking external_id', booking.external_id);
    if (booking.status !== 'Scheduled') fail('status', booking.status);
    else ok('status Scheduled');
    if (booking.email?.toLowerCase() !== CONTACT_EMAIL) fail('booking email', booking.email);
    else ok('booking linked email');
    if (booking.lead_id !== lead?.id) fail('booking.lead_id != lead.id');
    else ok('booking→lead FK');
    if (!booking.set_by_id) fail('set_by_id not resolved (Riley Chen)');
    else ok('set_by_id resolved');
    if (!booking.closer_id) fail('closer_id not resolved (Jamie Alvarez)');
    else ok('closer_id resolved');
    if (!booking.utm?.utm_source) fail('utm missing');
    else ok('utm', booking.utm.utm_source);
  }

  section('7. Reschedule → same row, new start');
  const resched = structuredClone(booked);
  resched.hookType = 'Call rescheduled';
  resched.event.utc_start_time = '2026-04-10T15:00:00.000Z';
  resched.event.start_time = '2026-04-10T15:00:00.000Z';
  const rRes = await postIclosed(resched);
  if (rRes.status === 200 && rRes.json.ok) ok('reschedule webhook', `id=${rRes.json.id}`);
  else fail('reschedule webhook', `${rRes.status} ${JSON.stringify(rRes.json)}`);

  const { data: booking2 } = await sb
    .from('bookings')
    .select('id, start_time, status')
    .eq('org_id', org.id)
    .eq('source', 'iclosed')
    .eq('external_id', CALL_ID);
  if (!booking2 || booking2.length !== 1) fail('expected exactly 1 booking after reschedule', String(booking2?.length));
  else if (booking2[0].id !== booking?.id) fail('reschedule created a new row');
  else if (!String(booking2[0].start_time).includes('2026-04-10')) fail('start_time not updated', booking2[0].start_time);
  else ok('same row updated', booking2[0].start_time);

  section('8. Cancel → Canceled');
  const cancel = structuredClone(booked);
  cancel.hookType = 'Call cancelled';
  cancel.event.canceled = true;
  cancel.invitee.canceled = true;
  cancel.event.utc_start_time = booking2?.[0]?.start_time || booked.event.utc_start_time;
  const xRes = await postIclosed(cancel);
  if (xRes.status === 200 && xRes.json.ok) ok('cancel webhook');
  else fail('cancel webhook', `${xRes.status} ${JSON.stringify(xRes.json)}`);
  const { data: booking3 } = await sb
    .from('bookings')
    .select('status')
    .eq('id', booking?.id)
    .maybeSingle();
  if (booking3?.status !== 'Canceled') fail('status after cancel', booking3?.status);
  else ok('status Canceled');

  section('9. Outcome skipped (Whop is king)');
  const outcome = {
    hookType: 'Outcome added',
    trigger: { id: 'callOutcome', name: 'Outcome added' },
    id: `outcome-${RUN}`,
    outcome: { result: 'WON' },
    event: { uuid: CALL_ID },
  };
  const oRes = await postIclosed(outcome);
  if (oRes.status === 200 && (oRes.json.skipped || oRes.json.ok)) ok('outcome skipped/logged', JSON.stringify(oRes.json));
  else fail('outcome', `${oRes.status} ${JSON.stringify(oRes.json)}`);
  const { data: closedCheck } = await sb
    .from('bookings')
    .select('closed, cash_collected')
    .eq('id', booking?.id)
    .maybeSingle();
  if (closedCheck?.closed === true) fail('outcome must not set closed=true');
  else ok('closed untouched by outcome');

  section('10. Isolation');
  const { data: wrongOrg } = await sb
    .from('bookings')
    .select('id')
    .eq('external_id', CALL_ID)
    .eq('source', 'iclosed')
    .neq('org_id', org.id);
  if (wrongOrg?.length) fail('booking leaked to another org', String(wrongOrg.length));
  else ok('booking only on emanfba');

  section('11. Ingestion events');
  const { data: events } = await sb
    .from('ingestion_events')
    .select('event_type, status, source')
    .eq('org_id', org.id)
    .eq('source', 'iclosed')
    .order('received_at', { ascending: false })
    .limit(10);
  const types = (events || []).map((e) => `${e.event_type}:${e.status}`);
  ok('recent events', types.slice(0, 6).join(' | ') || '(none)');
  if (!(events || []).some((e) => e.status === 'processed')) fail('no processed iclosed events');

  // cleanup smoke reps (keep lead/booking for inspection unless CLEANUP=1)
  if (process.env.SMOKE_CLEANUP === '1') {
    await sb.from('sales_reps').delete().eq('org_id', org.id).eq('source', 'smoke').like('external_id', `${RUN}%`);
    await sb.from('bookings').delete().eq('id', booking?.id);
    await sb.from('leads').delete().eq('id', lead?.id);
    ok('cleaned smoke rows');
  } else {
    ok('left smoke rows in DB', `lead ${lead?.id} booking ${booking?.id}`);
  }

  console.log(failed ? `\nFAILED (${failed})` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
