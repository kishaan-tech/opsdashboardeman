import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { formsRouter } from './routes/forms.js';
import { bookingsRouter } from './routes/bookings.js';
import { paymentsRouter } from './routes/payments.js';

// .env lives at the repo root (one level above the server workspace)
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

export const app = express();
app.use(express.json({ limit: '1mb' }));

// On Vercel the function is mounted under /api, so accept both prefixes.
const WH = ['/webhooks', '/api/webhooks'];
const HEALTH = ['/health', '/api/health'];

app.get(HEALTH, (_req, res) => res.json({ ok: true, runtime: process.env.VERCEL ? 'vercel' : 'node' }));

// Shared-secret gate. Senders pass `x-webhook-secret` or `?secret=`
// (Typeform/Calendly can't always set custom headers — use the query form).
app.use(WH, (req, res, next) => {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || secret === 'change-me') {
    console.warn('WEBHOOK_SECRET is not set — refusing webhook traffic');
    return res.status(503).json({ ok: false, error: 'webhook secret not configured' });
  }
  const provided = req.get('x-webhook-secret') ?? req.query.secret;
  if (provided !== secret) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
});

app.use([...WH.map((p) => `${p}/forms`)], formsRouter);
app.use([...WH.map((p) => `${p}/bookings`)], bookingsRouter);
app.use([...WH.map((p) => `${p}/payments`)], paymentsRouter);

app.use((err, _req, res, _next) => {
  console.error('unhandled error:', err);
  res.status(500).json({ ok: false, error: 'internal error' });
});
