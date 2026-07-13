import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { ingest, upsertLead } from '../lib/ingest.js';
import { paymentSchema } from '../schemas/index.js';

// POST /webhooks/payments
// A payment upserts a transaction. If the payer's email matches a lead with a
// booking, the transaction is linked to their most recent booking and — when
// the payment succeeded — that booking is marked closed. Cash is the one
// signal nobody forgets to enter, so close rate stops depending on checkboxes.
export const paymentsRouter = Router();

const SUCCESS_STATUSES = new Set(['succeeded', 'paid', 'completed', 'complete', 'success']);

paymentsRouter.post('/', async (req, res) => {
  const payload = normalize(req.body);
  const result = await ingest({
    source: req.query.source ?? 'payment',
    eventType: `payment.${(payload?.status ?? 'event').toLowerCase()}`,
    externalId: payload?.payment_id,
    payload,
    schema: paymentSchema,
    apply: async (data, { source, externalId }) => {
      // attach to the payer's most recent booking, if we can find one
      let bookingId = null;
      if (data.email) {
        const leadId = await upsertLead({ email: data.email, name: data.name, sourceLabel: 'payment' });
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
          source,
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
        await supabase.from('bookings').update({ closed: true }).eq('id', bookingId);
      }
      return { table: 'transactions', id: row.id };
    },
  });
  res.status(result.status).json(result.body);
});

// Example Stripe adapter (payment_intent.succeeded), if not using Zapier's
// field mapping:
//   return {
//     payment_id: body.data.object.id,
//     amount: body.data.object.amount / 100,
//     status: 'succeeded',
//     email: body.data.object.receipt_email,
//     paid_at: new Date(body.data.object.created * 1000).toISOString(),
//   }
function normalize(body) {
  return body;
}
