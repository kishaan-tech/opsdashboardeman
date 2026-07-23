import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { ingest, upsertLead } from '../lib/ingest.js';
import { paymentSchema } from '../schemas/index.js';
import { normalizePaymentPayload } from '../lib/vendors/index.js';

// POST /webhooks/payments?source=whop
// A payment upserts a transaction. If the payer's email matches a lead with a
// booking, the transaction is linked to their most recent booking and — when
// the payment succeeded — that booking is marked closed.
export const paymentsRouter = Router();

const SUCCESS_STATUSES = new Set(['succeeded', 'paid', 'completed', 'complete', 'success']);

paymentsRouter.post('/', async (req, res) => {
  const source = String(req.query.source ?? 'payment');
  const payload = normalizePaymentPayload(req.body, source);
  const result = await ingest({
    source,
    eventType: `payment.${(payload?.status ?? 'event').toLowerCase()}`,
    externalId: payload?.payment_id,
    payload,
    schema: paymentSchema,
    apply: async (data, { source: src, externalId }) => {
      let bookingId = null;
      if (data.email) {
        const leadId = await upsertLead({
          email: data.email,
          name: data.name,
          sourceLabel: 'payment',
        });
        const { data: booking } = await supabase
          .from('bookings').select('id')
          .eq('lead_id', leadId)
          .order('start_time', { ascending: false })
          .limit(1)
          .maybeSingle();
        bookingId = booking?.id ?? null;
      }

      const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
      const { data: row, error } = await supabase
        .from('transactions')
        .upsert({
          source: src,
          external_id: externalId,
          transaction_id: data.payment_id,
          amount: data.amount,
          date: paidAt.toISOString().slice(0, 10),
          status: data.status,
          booking_id: bookingId,
        }, { onConflict: 'source,external_id' })
        .select('id')
        .single();
      if (error) throw new Error(error.message);

      if (bookingId && SUCCESS_STATUSES.has(data.status.toLowerCase())) {
        await supabase.from('bookings').update({
          closed: true,
          cash_collected: data.amount,
        }).eq('id', bookingId);
      }
      return { table: 'transactions', id: row.id };
    },
  });
  res.status(result.status).json(result.body);
});
