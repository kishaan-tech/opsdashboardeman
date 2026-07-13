import 'dotenv/config';
import express from 'express';
import { formsRouter } from './routes/forms.js';
import { bookingsRouter } from './routes/bookings.js';
import { paymentsRouter } from './routes/payments.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Shared-secret gate for all webhook endpoints. Configure each sender to pass
// the secret as an `x-webhook-secret` header (or `?secret=` if the tool can't
// set headers).
app.use('/webhooks', (req, res, next) => {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || secret === 'change-me') {
    console.warn('WEBHOOK_SECRET is not set — refusing webhook traffic');
    return res.status(503).json({ ok: false, error: 'webhook secret not configured' });
  }
  const provided = req.get('x-webhook-secret') ?? req.query.secret;
  if (provided !== secret) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
});

app.use('/webhooks/forms', formsRouter);
app.use('/webhooks/bookings', bookingsRouter);
app.use('/webhooks/payments', paymentsRouter);
// New data source? Add a schema in schemas/, a route file that calls ingest(),
// and mount it here.

app.use((err, _req, res, _next) => {
  console.error('unhandled error:', err);
  res.status(500).json({ ok: false, error: 'internal error' });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`ingestion api listening on :${port}`));
