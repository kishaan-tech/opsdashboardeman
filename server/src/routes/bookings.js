import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { ingest, upsertLead, resolveSalesRepId } from '../lib/ingest.js';
import { bookingSchema } from '../schemas/index.js';
import { normalizeBookingPayload } from '../lib/vendors/index.js';

// POST /webhooks/bookings?source=calendly
// Same booking_id on a later event (reschedule, cancel) updates the existing
// row instead of creating a new one — upsert is on source + external_id.
// The lead is found-or-created by email and linked via lead_id.
// Contact (lead_name / email / phone) is stored on the booking too so the
// Bookings table matches Leads without requiring a join.
export const bookingsRouter = Router();

bookingsRouter.post('/', async (req, res) => {
  const source = String(req.query.source ?? 'booking');
  const payload = normalizeBookingPayload(req.body, source);
  const result = await ingest({
    source,
    eventType: `booking.${(payload?.status ?? 'event').toLowerCase()}`,
    externalId: payload?.booking_id,
    payload,
    schema: bookingSchema,
    apply: async (data, { source: src, externalId }) => {
      const leadId = await upsertLead({
        email: data.email,
        name: data.name,
        phone: data.phone,
        sourceLabel: 'booking',
      });

      // Prefer payload contact; fill gaps from the linked lead row.
      const { data: lead } = await supabase
        .from('leads')
        .select('lead_name, email, phone')
        .eq('id', leadId)
        .maybeSingle();

      const leadName = data.name || lead?.lead_name || null;
      const email = (data.email || lead?.email || '').toLowerCase() || null;
      const phone = data.phone || lead?.phone || null;

      const utm = data.utm ?? null;
      const setById = await resolveSalesRepId(utm?.utm_source || utm?.utm_content);
      const closerId = await resolveSalesRepId(utm?.utm_campaign);

      const rowPatch = {
        source: src,
        external_id: externalId,
        booking_id: data.booking_id,
        start_time: new Date(data.starts_at).toISOString(),
        status: data.status,
        lead_name: leadName,
        email,
        phone,
        email_calendly: data.email,
        lead_id: leadId,
        utm,
      };
      if (setById) rowPatch.set_by_id = setById;
      if (closerId) rowPatch.closer_id = closerId;

      let { data: row, error } = await supabase
        .from('bookings')
        .upsert(rowPatch, { onConflict: 'source,external_id' })
        .select('id')
        .single();

      // Drop optional columns if the DB hasn't been migrated yet.
      if (error && /(utm|lead_name|\bemail\b|phone)/i.test(error.message)) {
        console.warn('bookings optional columns missing — apply migrations 0004 + 0005');
        delete rowPatch.utm;
        delete rowPatch.lead_name;
        delete rowPatch.email;
        delete rowPatch.phone;
        ({ data: row, error } = await supabase
          .from('bookings')
          .upsert(rowPatch, { onConflict: 'source,external_id' })
          .select('id')
          .single());
      }
      if (error) throw new Error(error.message);
      return { table: 'bookings', id: row.id };
    },
  });
  res.status(result.status).json(result.body);
});
