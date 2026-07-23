#!/usr/bin/env node
// Register Typeform (+ Calendly if token allows) webhooks against a public base URL.
//
// Usage:
//   WEBHOOK_BASE_URL=https://your-app.vercel.app ORG_SLUG=dooly npm run register-webhooks
//
// Env: TYPEFORM_API_KEY, CALENDLY_API_KEY (optional), WEBHOOK_SECRET
//      TYPEFORM_FORM_IDS (optional, comma-separated)
//      ORG_SLUG (required for multi-tenant paths; default dooly)

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const TYPEFORM_FORM_IDS = (process.env.TYPEFORM_FORM_IDS || 'AbXAZxlr')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ORG_SLUG = (process.env.ORG_SLUG || 'dooly').toLowerCase();
const TAG = `ops-hub-${ORG_SLUG}`;

const {
  TYPEFORM_API_KEY,
  CALENDLY_API_KEY,
  WEBHOOK_SECRET,
  WEBHOOK_BASE_URL,
} = process.env;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function baseUrl() {
  const raw = (WEBHOOK_BASE_URL || process.argv[2] || '').replace(/\/$/, '');
  if (!raw) {
    fail(
      'Set WEBHOOK_BASE_URL (e.g. https://ops-hub.vercel.app) or pass it as argv[2]',
    );
  }
  return raw;
}

async function tf(method, urlPath, body) {
  const res = await fetch(`https://api.typeform.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TYPEFORM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Typeform ${method} ${urlPath} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

async function calendly(method, urlPath, body) {
  const res = await fetch(`https://api.calendly.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${CALENDLY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

async function registerTypeform(base) {
  if (!TYPEFORM_API_KEY) fail('Missing TYPEFORM_API_KEY');
  const url = `${base}/api/webhooks/${ORG_SLUG}/forms?source=typeform&secret=${encodeURIComponent(WEBHOOK_SECRET)}`;

  for (const formId of TYPEFORM_FORM_IDS) {
    console.log(`\nTypeform form ${formId} → ${url.replace(WEBHOOK_SECRET, '***')}`);
    const result = await tf('PUT', `/forms/${formId}/webhooks/${TAG}`, {
      url,
      enabled: true,
      verify_ssl: true,
    });
    console.log(`  ✓ tag=${TAG} enabled=${result?.enabled ?? true}`);
  }
}

async function registerCalendly(base) {
  if (!CALENDLY_API_KEY) {
    console.log('\nCalendly: skipped (no CALENDLY_API_KEY)');
    return;
  }

  const url = `${base}/api/webhooks/${ORG_SLUG}/bookings?source=calendly&secret=${encodeURIComponent(WEBHOOK_SECRET)}`;
  console.log(`\nCalendly → ${url.replace(WEBHOOK_SECRET, '***')}`);

  const me = await calendly('GET', '/users/me');
  if (!me.ok) {
    console.log(`  ✗ users/me failed (${me.status}):`, JSON.stringify(me.json).slice(0, 200));
    return;
  }
  const org = me.json.resource.current_organization;
  const user = me.json.resource.uri;

  const created = await calendly('POST', '/webhook_subscriptions', {
    url,
    events: ['invitee.created', 'invitee.canceled'],
    organization: org,
    user,
    scope: 'user',
  });

  if (created.ok) {
    console.log('  ✓ subscription created:', created.json?.resource?.uri ?? 'ok');
    return;
  }

  if (created.status === 403 || created.status === 401) {
    console.log(`  ✗ Calendly refused create (${created.status}).`);
    console.log('    Your PAT needs the webhooks:write scope, OR create this manually:');
    console.log(`    URL: ${url.replace(WEBHOOK_SECRET, '<WEBHOOK_SECRET>')}`);
    console.log('    Events: invitee.created, invitee.canceled');
    return;
  }

  console.log(`  ✗ ${created.status}:`, JSON.stringify(created.json).slice(0, 400));
}

async function main() {
  if (!WEBHOOK_SECRET || WEBHOOK_SECRET === 'change-me') {
    fail('WEBHOOK_SECRET missing or still change-me');
  }
  const base = baseUrl();
  console.log(`Registering webhooks for org=${ORG_SLUG} against ${base}`);
  await registerTypeform(base);
  await registerCalendly(base);
  console.log('\nDone. Smoke-test: curl', `${base}/api/health`);
}

main().catch((err) => fail(err.message || String(err)));
