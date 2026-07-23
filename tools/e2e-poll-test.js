#!/usr/bin/env node
// End-to-end: poll Typeform + Calendly APIs → POST into local ingestion API → verify via Supabase.
//
// Usage: npm run e2e-poll   (or: node tools/e2e-poll-test.js)
// Requires local API on :8787 (npm run api) and keys in .env

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const {
  TYPEFORM_API_KEY,
  CALENDLY_API_KEY,
  WEBHOOK_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TYPEFORM_FORM_IDS = 'AbXAZxlr',
  E2E_API_BASE = 'http://localhost:8787',
} = process.env;

const FORM_IDS = TYPEFORM_FORM_IDS.split(',').map((s) => s.trim()).filter(Boolean);
const secret = encodeURIComponent(WEBHOOK_SECRET);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = { typeform: [], calendly: [], payment: null, errors: [] };

function log(step, msg) {
  console.log(`[${step}] ${msg}`);
}

async function postWebhook(pathSuffix, body) {
  const url = `${E2E_API_BASE}${pathSuffix}${pathSuffix.includes('?') ? '&' : '?'}secret=${secret}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function pollTypeform() {
  log('typeform', `Fetching recent responses for forms: ${FORM_IDS.join(', ')}`);
  for (const formId of FORM_IDS) {
    const url = `https://api.typeform.com/forms/${formId}/responses?page_size=5&completed=true`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TYPEFORM_API_KEY}` },
    });
    const data = await res.json();
    if (!res.ok) {
      results.errors.push(`Typeform ${formId}: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
      continue;
    }

    // Need form definition for field titles — fetch once
    const formRes = await fetch(`https://api.typeform.com/forms/${formId}`, {
      headers: { Authorization: `Bearer ${TYPEFORM_API_KEY}` },
    });
    const formDef = await formRes.json();
    const title = formDef.title || formId;
    const fields = formDef.fields || [];

    const items = data.items || [];
    log('typeform', `${formId} (${title}): ${items.length} recent response(s)`);

    for (const item of items) {
      // Rebuild a webhook-shaped payload so our normalizeTypeform path runs
      const payload = {
        event_type: 'form_response',
        form_response: {
          form_id: formId,
          token: item.token || item.response_id,
          submitted_at: item.submitted_at,
          landed_at: item.landed_at,
          hidden: item.hidden || {},
          definition: { id: formId, title, fields },
          answers: item.answers || [],
        },
      };

      const out = await postWebhook('/webhooks/forms?source=typeform', payload);
      const email = (item.answers || []).find((a) => a.type === 'email')?.email
        || Object.values(item.hidden || {}).find((v) => typeof v === 'string' && v.includes('@'));

      results.typeform.push({
        formId,
        token: item.token,
        email: email || null,
        submitted_at: item.submitted_at,
        http: out.status,
        body: out.json,
      });
      log('typeform', `  → ${item.token?.slice(0, 12)}… email=${email || '?'} → ${out.status} ${JSON.stringify(out.json)}`);
    }
  }
}

async function pollCalendly() {
  log('calendly', 'Fetching user + recent invitees');
  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${CALENDLY_API_KEY}` },
  });
  const me = await meRes.json();
  if (!meRes.ok) {
    results.errors.push(`Calendly users/me: ${meRes.status}`);
    return;
  }
  const userUri = me.resource.uri;
  const orgUri = me.resource.current_organization;

  // List scheduled events in the last 30 days
  const minStart = new Date(Date.now() - 30 * 864e5).toISOString();
  const evUrl = new URL('https://api.calendly.com/scheduled_events');
  evUrl.searchParams.set('organization', orgUri);
  evUrl.searchParams.set('min_start_time', minStart);
  evUrl.searchParams.set('count', '5');
  evUrl.searchParams.set('status', 'active');

  const evRes = await fetch(evUrl, {
    headers: { Authorization: `Bearer ${CALENDLY_API_KEY}` },
  });
  const evData = await evRes.json();
  if (!evRes.ok) {
    // fallback: user-scoped
    const evUrl2 = new URL('https://api.calendly.com/scheduled_events');
    evUrl2.searchParams.set('user', userUri);
    evUrl2.searchParams.set('min_start_time', minStart);
    evUrl2.searchParams.set('count', '5');
    const evRes2 = await fetch(evUrl2, {
      headers: { Authorization: `Bearer ${CALENDLY_API_KEY}` },
    });
    const evData2 = await evRes2.json();
    if (!evRes2.ok) {
      results.errors.push(`Calendly events: ${evRes.status}/${evRes2.status} ${JSON.stringify(evData2).slice(0, 200)}`);
      return;
    }
    Object.assign(evData, evData2);
  }

  const events = evData.collection || [];
  log('calendly', `${events.length} recent scheduled event(s)`);

  for (const event of events) {
    const invUrl = `${event.uri}/invitees?count=5`;
    const invRes = await fetch(invUrl, {
      headers: { Authorization: `Bearer ${CALENDLY_API_KEY}` },
    });
    const invData = await invRes.json();
    if (!invRes.ok) {
      results.errors.push(`Invitees for ${event.uri}: ${invRes.status}`);
      continue;
    }

    for (const invitee of invData.collection || []) {
      // Shape like Calendly webhook (invitee.created)
      const payload = {
        event: invitee.status === 'canceled' ? 'invitee.canceled' : 'invitee.created',
        created_at: invitee.created_at,
        payload: {
          ...invitee,
          scheduled_event: {
            uri: event.uri,
            name: event.name,
            start_time: event.start_time,
            end_time: event.end_time,
            event_type: event.event_type,
          },
        },
      };

      const out = await postWebhook('/webhooks/bookings?source=calendly', payload);
      results.calendly.push({
        invitee: invitee.uri?.split('/').pop(),
        email: invitee.email,
        start: event.start_time,
        http: out.status,
        body: out.json,
      });
      log('calendly', `  → ${invitee.email} @ ${event.start_time} → ${out.status} ${JSON.stringify(out.json)}`);
    }
  }
}

async function smokePayment() {
  // Synthetic Whop-shaped payment for the first Typeform email we ingested
  const email = results.typeform.find((r) => r.email)?.email
    || results.calendly.find((r) => r.email)?.email;
  if (!email) {
    log('payment', 'skipped (no email from polls)');
    return;
  }
  const paymentId = `pay_e2e_${Date.now()}`;
  const payload = {
    type: 'payment.succeeded',
    data: {
      id: paymentId,
      status: 'succeeded',
      amount_after_fees: 1,
      paid_at: new Date().toISOString(),
      user: { email, name: 'E2E Test' },
    },
  };
  const out = await postWebhook('/webhooks/payments?source=whop', payload);
  results.payment = { email, paymentId, http: out.status, body: out.json };
  log('payment', `→ ${email} ${paymentId} → ${out.status} ${JSON.stringify(out.json)}`);
}

async function verifyDb() {
  log('verify', 'Checking Supabase for ingested rows');
  const emails = [
    ...results.typeform.map((r) => r.email),
    ...results.calendly.map((r) => r.email),
  ].filter(Boolean);

  const unique = [...new Set(emails.map((e) => e.toLowerCase()))];
  for (const email of unique.slice(0, 8)) {
    const { data: lead, error: leadErr } = await supabase
      .from('leads').select('id, lead_name, email, source_2')
      .ilike('email', email).maybeSingle();
    const { data: bookings, error: bookErr } = await supabase
      .from('bookings').select('id, status, start_time, lead_id, email_calendly, closed')
      .eq('email_calendly', email).limit(3);

    console.log(`\n  email=${email}`);
    if (leadErr) console.log('    lead ERROR:', leadErr.message);
    else console.log('    lead:', lead ? `${lead.id} name=${lead.lead_name} source=${lead.source_2}` : 'NOT FOUND');
    if (bookErr) console.log('    bookings ERROR:', bookErr.message);
    else console.log('    bookings:', (bookings || []).length
      ? bookings.map((b) => `${b.status} ${b.start_time} closed=${b.closed}`).join(' | ')
      : 'none');
  }

  const { data: recentEvents, error: evErr } = await supabase
    .from('ingestion_events')
    .select('source, event_type, status, error, external_id, received_at')
    .order('received_at', { ascending: false })
    .limit(10);
  console.log('\n  recent ingestion_events:');
  if (evErr) console.log('    ERROR:', evErr.message);
  for (const e of recentEvents || []) {
    console.log(`    ${e.received_at} ${e.source} ${e.event_type} → ${e.status}${e.error ? ` ERR: ${e.error}` : ''}`);
  }
}

async function main() {
  console.log(`E2E poll test → ${E2E_API_BASE}\n`);

  const health = await fetch(`${E2E_API_BASE}/health`).then((r) => r.json());
  if (!health.ok) throw new Error('API /health failed');
  log('health', JSON.stringify(health));

  await pollTypeform();
  await pollCalendly();
  await smokePayment();
  await verifyDb();

  const tfOk = results.typeform.filter((r) => r.http === 200 && r.body?.ok).length;
  const calOk = results.calendly.filter((r) => r.http === 200 && r.body?.ok).length;
  console.log('\n======== SUMMARY ========');
  console.log(`Typeform ingested: ${tfOk}/${results.typeform.length}`);
  console.log(`Calendly ingested: ${calOk}/${results.calendly.length}`);
  console.log(`Payment: ${results.payment ? `${results.payment.http} ${JSON.stringify(results.payment.body)}` : 'n/a'}`);
  if (results.errors.length) {
    console.log('Errors:');
    results.errors.forEach((e) => console.log('  -', e));
  }
  const failed = results.typeform.some((r) => r.http !== 200 || !r.body?.ok)
    || results.calendly.some((r) => r.http !== 200 || !r.body?.ok)
    || results.errors.length > 0
    || (results.payment && (results.payment.http !== 200 || !results.payment.body?.ok));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
