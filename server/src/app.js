import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { formsRouter } from './routes/forms.js';
import { bookingsRouter } from './routes/bookings.js';
import { paymentsRouter } from './routes/payments.js';
import { iclosedRouter } from './routes/iclosed.js';
import { adminRouter, requireAuth } from './routes/admin.js';
import { resolveOrgFromRequest } from './lib/org.js';

// .env lives at the repo root (one level above the server workspace)
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

export const app = express();
app.use(express.json({ limit: '15mb' }));

// On Vercel the function is mounted under /api, so accept both prefixes.
const WH = ['/webhooks', '/api/webhooks'];
const HEALTH = ['/health', '/api/health'];
const ADMIN = ['/admin', '/api/admin'];

app.get(HEALTH, (_req, res) => res.json({ ok: true, runtime: process.env.VERCEL ? 'vercel' : 'node' }));

/** Resolve org + validate per-org (or legacy global) webhook secret. */
async function orgWebhookGate(req, res, next) {
  try {
    const resolved = await resolveOrgFromRequest(req);
    if (!resolved) {
      return res.status(404).json({ ok: false, error: 'unknown or inactive org' });
    }
    const provided = req.get('x-webhook-secret') ?? req.query.secret;
    if (!resolved.webhookSecret) {
      console.warn(`org ${resolved.org.slug}: no webhook secret configured`);
      return res.status(503).json({ ok: false, error: 'webhook secret not configured for org' });
    }
    if (provided !== resolved.webhookSecret) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    req.org = resolved.org;
    req.orgIntegrations = resolved.integrations;
    next();
  } catch (err) {
    console.error('orgWebhookGate:', err);
    res.status(500).json({ ok: false, error: 'org resolution failed' });
  }
}

// Preferred: /webhooks/:orgSlug/{forms|bookings|payments|iclosed}
for (const base of WH) {
  app.use(`${base}/:orgSlug/forms`, orgWebhookGate, formsRouter);
  app.use(`${base}/:orgSlug/bookings`, orgWebhookGate, bookingsRouter);
  app.use(`${base}/:orgSlug/payments`, orgWebhookGate, paymentsRouter);
  app.use(`${base}/:orgSlug/iclosed`, orgWebhookGate, iclosedRouter);
}

// Legacy dual-accept: /webhooks/{forms|bookings|payments}?org=<slug>
// (same handlers; org resolved from query)
for (const base of WH) {
  app.use(`${base}/forms`, orgWebhookGate, formsRouter);
  app.use(`${base}/bookings`, orgWebhookGate, bookingsRouter);
  app.use(`${base}/payments`, orgWebhookGate, paymentsRouter);
}

// Platform admin + session helpers (JWT)
for (const base of ADMIN) {
  app.use(base, requireAuth, adminRouter);
}

app.use((err, _req, res, _next) => {
  console.error('unhandled error:', err);
  res.status(500).json({ ok: false, error: 'internal error' });
});
