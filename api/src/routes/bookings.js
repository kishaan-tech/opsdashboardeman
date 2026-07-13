import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { ingest, upsertLead } from '../lib/ingest.js';
import { bookingSchema } from '../schemas/index.js';

// POST /webhooks/bookings
// Same booking_id on a later event (reschedule, cancel) updates the existing
// row instead of creating a new one — upsert is on source + external_id.
// The lead is found-or-created by email and linked via lead_id.
export const bookingsRouter = Router();

bookingsRouter.post('/', async (req, res) => {
  const payload = normalize(req.body);
  const result = await ingest({
    source: req.query.source ?? 'booking',
    eventType: `booking.${(payload?.status ?? 'event').toLowerCase()}`,
    externalId: payload?.booking_id,
    payload,
    schema: bookingSchema,
    apply: async (data, { source, externalId }) => {
      const leadId = await upsertLead({
        email: data.email,
        name: data.name,
        phone: data.phone,
        sourceLabel: 'booking',
      });
      const { data: row, error } = await supabase
        .from('bookings')
        .upsert({
          source,
          external_id: externalId,
          start_time: new Date(data.starts_at).toISOString(),
          status: data.status,
          email_calendly: data.email,
          lead_id: leadId,
        }, { onConflict: 'source,external_id' })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return { table: 'bookings', id: row.id };
    },
  });
  res.status(result.status).json(result.body);
});

// Adapt Calendly/Cal.com payloads here if not field-mapping in Zapier.
function normalize(body) {
  return body;
}
