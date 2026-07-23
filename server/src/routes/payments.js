import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { ingest, upsertLead } from '../lib/ingest.js';
import { paymentSchema } from '../schemas/index.js';
import { normalizePaymentPayload } from '../lib/vendors/index.js';
import { applyPaymentToBooking, paymentCashAndRevenue } from '../lib/paymentBooking.js';

// POST /webhooks/:orgSlug/payments?source=whop|fanbasis
export const paymentsRouter = Router({ mergeParams: true });

// Selected payments_providers (whop and/or fanbasis) each may set closed /
// cash_collected (close cash) and revenue_generated (deal / subscription total).

paymentsRouter.post('/', async (req, res) => {
  const orgId = req.org?.id;
  if (!orgId) return res.status(400).json({ ok: false, error: 'org required' });

  const source = String(req.query.source ?? 'payment');
  const payload = normalizePaymentPayload(req.body, source);
  const result = await ingest({
    orgId,
    source,
    eventType: `payment.${(payload?.status ?? 'event').toLowerCase()}`,
    externalId: payload?.payment_id,
    payload,
    schema: paymentSchema,
    apply: async (data, { source: src, externalId }) => {
      let bookingId = null;
      if (data.email) {
        const leadId = await upsertLead({
          orgId,
          email: data.email,
          name: data.name,
          sourceLabel: 'payment',
        });
        const { data: booking } = await supabase
          .from('bookings').select('id')
          .eq('org_id', orgId)
          .eq('lead_id', leadId)
          .order('start_time', { ascending: false })
          .limit(1)
          .maybeSingle();
        bookingId = booking?.id ?? null;
      }

      const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
      const email = data.email ? String(data.email).trim().toLowerCase() : null;
      const leadName = data.name ? String(data.name).trim() : null;
      const money = paymentCashAndRevenue(data);
      const { data: row, error } = await supabase
        .from('transactions')
        .upsert({
          org_id: orgId,
          source: src,
          external_id: externalId,
          transaction_id: data.payment_id,
          amount: data.amount,
          date: paidAt.toISOString().slice(0, 10),
          status: data.status,
          booking_id: bookingId,
          email,
          lead_name: leadName,
          cash_collected: money.cash_collected,
          revenue_generated: money.revenue_generated,
        }, { onConflict: 'org_id,source,external_id' })
        .select('id')
        .single();
      if (error) throw new Error(error.message);

      await applyPaymentToBooking(bookingId, data);
      return { table: 'transactions', id: row.id };
    },
  });
  res.status(result.status).json(result.body);
});
