import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { ingest, upsertLead, resolveSalesRepId } from '../lib/ingest.js';
import { bookingSchema } from '../schemas/index.js';
import { normalizeBookingPayload } from '../lib/vendors/index.js';

// POST /webhooks/:orgSlug/bookings?source=calendly
// (legacy: /webhooks/bookings?org=<slug>&source=calendly)
export const bookingsRouter = Router({ mergeParams: true });

bookingsRouter.post('/', async (req, res) => {
  const orgId = req.org?.id;
  if (!orgId) return res.status(400).json({ ok: false, error: 'org required' });

  const source = String(req.query.source ?? 'booking');
  const payload = normalizeBookingPayload(req.body, source);
  const result = await ingest({
    orgId,
    source,
    eventType: `booking.${(payload?.status ?? 'event').toLowerCase()}`,
    externalId: payload?.booking_id,
    payload,
    schema: bookingSchema,
    apply: async (data, { source: src, externalId }) => {
      const leadId = await upsertLead({
        orgId,
        email: data.email,
        name: data.name,
        phone: data.phone,
        sourceLabel: 'booking',
      });

      const { data: lead } = await supabase
        .from('leads')
        .select('lead_name, email, phone')
        .eq('id', leadId)
        .maybeSingle();

      const leadName = data.name || lead?.lead_name || null;
      const email = (data.email || lead?.email || '').toLowerCase() || null;
      const phone = data.phone || lead?.phone || null;

      const utm = data.utm ?? null;
      const setById = await resolveSalesRepId(
        data.setter_hint || utm?.utm_source || utm?.utm_content,
        orgId,
      );
      const closerId = await resolveSalesRepId(
        data.closer_hint || utm?.utm_campaign,
        orgId,
      );

      const rowPatch = {
        org_id: orgId,
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
        .upsert(rowPatch, { onConflict: 'org_id,source,external_id' })
        .select('id')
        .single();

      if (error && /(utm|lead_name|\bemail\b|phone)/i.test(error.message)) {
        console.warn('bookings optional columns missing — apply migrations 0004 + 0005');
        delete rowPatch.utm;
        delete rowPatch.lead_name;
        delete rowPatch.email;
        delete rowPatch.phone;
        ({ data: row, error } = await supabase
          .from('bookings')
          .upsert(rowPatch, { onConflict: 'org_id,source,external_id' })
          .select('id')
          .single());
      }
      if (error) throw new Error(error.message);
      return { table: 'bookings', id: row.id };
    },
  });
  res.status(result.status).json(result.body);
});
