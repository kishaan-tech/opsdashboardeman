import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { ingest, upsertLead, resolveSalesRepId } from '../lib/ingest.js';
import { formSubmissionSchema, bookingSchema } from '../schemas/index.js';
import { normalizeIclosedWebhook } from '../lib/vendors/iclosed.js';

// POST /webhooks/:orgSlug/iclosed?secret=…
// Single URL for iClosed; fans out contact → leads, call → bookings.
// Outcomes / transactions are logged only (Whop owns closed/cash).

export const iclosedRouter = Router({ mergeParams: true });

async function applyBooking(data, { source: src, externalId, orgId }) {
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
}

iclosedRouter.post('/', async (req, res) => {
  const orgId = req.org?.id;
  if (!orgId) return res.status(400).json({ ok: false, error: 'org required' });

  const source = 'iclosed';
  let normalized;
  try {
    normalized = normalizeIclosedWebhook(req.body);
  } catch (err) {
    return res.status(422).json({ ok: false, error: String(err.message || err) });
  }

  if (normalized.kind === 'outcome' || normalized.kind === 'transaction' || normalized.kind === 'unknown') {
    const reason = normalized.kind === 'unknown'
      ? 'unrecognized iclosed payload'
      : 'iclosed outcome/transaction ignored (Whop owns closed/cash)';
    const result = await ingest({
      orgId,
      source,
      eventType: normalized.eventType,
      externalId: normalized.externalId,
      payload: normalized.payload || req.body,
      skipReason: reason,
    });
    return res.status(result.status).json({ ...result.body, reason: normalized.kind });
  }

  if (normalized.kind === 'contact') {
    const result = await ingest({
      orgId,
      source,
      eventType: normalized.eventType,
      externalId: normalized.externalId,
      payload: normalized.payload,
      schema: formSubmissionSchema,
      apply: async (data) => {
        const leadId = await upsertLead({
          orgId,
          email: data.email,
          name: data.name,
          phone: data.phone,
          sourceLabel: data.source ?? data.form_name,
          formAnswers: data.answers,
          formResponseUrl: data.form_response_url,
        });
        return { table: 'leads', id: leadId };
      },
    });
    return res.status(result.status).json(result.body);
  }

  const result = await ingest({
    orgId,
    source,
    eventType: normalized.eventType,
    externalId: normalized.externalId,
    payload: normalized.payload,
    schema: bookingSchema,
    apply: applyBooking,
  });
  res.status(result.status).json(result.body);
});
