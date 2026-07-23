// The one code path every inbound event goes through:
//
//   1. log the raw payload to ingestion_events (status: received)
//   2. validate with the route's Zod schema
//   3. apply the domain writes (idempotent — replays update, never duplicate)
//   4. mark the event processed / failed — the error message lands on the
//      event row, so debugging is "open the Events page", not guessing.

import { supabase } from './supabase.js';
import { flagIdentityMatches } from './identity.js';
import { touchOrgWebhook } from './org.js';

export async function ingest({
  orgId, source, eventType, externalId, payload, schema, apply, skipReason,
}) {
  if (!orgId) {
    return { status: 400, body: { ok: false, error: 'org_id required' } };
  }

  // 1. audit log first — even garbage payloads leave a trace
  const { data: event, error: logError } = await supabase
    .from('ingestion_events')
    .insert({
      org_id: orgId,
      source,
      event_type: eventType,
      external_id: externalId ?? null,
      payload,
    })
    .select('id')
    .single();

  let eventId = event?.id;

  if (logError) {
    if (logError.code === '23505') {
      // Same external_id already logged. Re-apply for processed/failed so
      // booking reschedules / cancel updates and contact refreshes upsert.
      // "skipped" stays a no-op.
      const { data: existing } = await supabase
        .from('ingestion_events')
        .select('id, status')
        .eq('org_id', orgId)
        .eq('source', source)
        .eq('external_id', externalId)
        .maybeSingle();
      if (!existing) {
        return { status: 200, body: { ok: true, duplicate: true } };
      }
      if (existing.status === 'skipped') {
        return { status: 200, body: { ok: true, duplicate: true, skipped: true } };
      }
      eventId = existing.id;
      console.warn(`re-applying event ${eventId} (${source}/${externalId}, was ${existing.status})`);
    } else {
      console.error('ingestion_events insert failed:', logError.message);
      return { status: 500, body: { ok: false, error: 'audit log unavailable' } };
    }
  }

  const finalize = (patch) =>
    supabase.from('ingestion_events')
      .update({ ...patch, processed_at: new Date().toISOString() })
      .eq('id', eventId);

  if (skipReason) {
    await finalize({ status: 'skipped', error: skipReason });
    touchOrgWebhook(orgId).catch(() => {});
    return { status: 200, body: { ok: true, skipped: true, event_id: eventId } };
  }

  // 2. validate
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    await finalize({ status: 'failed', error: `validation: ${detail}` });
    return { status: 422, body: { ok: false, error: detail, event_id: eventId } };
  }

  // 3. domain writes
  try {
    const { table, id } = await apply(parsed.data, { source, externalId, orgId });
    await finalize({ status: 'processed', record_table: table, record_id: id, error: null });
    touchOrgWebhook(orgId).catch(() => {});
    return { status: 200, body: { ok: true, id, event_id: eventId } };
  } catch (err) {
    await finalize({ status: 'failed', error: String(err.message ?? err) });
    return { status: 500, body: { ok: false, error: String(err.message ?? err), event_id: eventId } };
  }
}

// Find-or-create a lead by email so every inbound event attaches to a real
// lead row — no floating records. Fills in name/phone/answers if the existing
// row is missing them (answers always refresh to the latest Typeform submit).
// Returns the lead id.
export async function upsertLead({
  orgId, email, name, phone, sourceLabel, formAnswers, formResponseUrl,
}) {
  if (!orgId) throw new Error('orgId required for upsertLead');
  const normalized = email.trim().toLowerCase();

  const { data: existing, error: findError } = await supabase
    .from('leads')
    .select('id, lead_name, phone')
    .eq('org_id', orgId)
    .ilike('email', normalized)
    .maybeSingle();
  if (findError) throw new Error(`lead lookup failed: ${findError.message}`);

  if (existing) {
    const patch = {};
    if (!existing.lead_name && name) patch.lead_name = name;
    if (!existing.phone && phone) patch.phone = phone;
    if (sourceLabel) patch.source_2 = sourceLabel;
    if (formAnswers && Object.keys(formAnswers).length) patch.form_answers = formAnswers;
    if (formResponseUrl) patch.form_response_url = formResponseUrl;
    if (Object.keys(patch).length) {
      let { error } = await supabase.from('leads').update(patch).eq('id', existing.id);
      // Pre-migration DBs may lack form_answers / form_response_url — retry without them.
      if (error && /form_answers|form_response_url/.test(error.message)) {
        delete patch.form_answers;
        delete patch.form_response_url;
        console.warn('leads.form_answers missing — apply supabase/migrations/0004_webhook_fields.sql');
        if (Object.keys(patch).length) {
          ({ error } = await supabase.from('leads').update(patch).eq('id', existing.id));
        } else {
          error = null;
        }
      }
      if (error) throw new Error(`lead update failed: ${error.message}`);
    }
    const contact = {
      email: normalized,
      lead_name: patch.lead_name ?? existing.lead_name ?? name ?? null,
      phone: patch.phone ?? existing.phone ?? phone ?? null,
    };
    await syncContactToBookings(existing.id, contact);
    // Same-person check across different emails (phone / name rules)
    flagIdentityMatches(existing.id, orgId).catch((err) =>
      console.warn('flagIdentityMatches:', err.message ?? err));
    return existing.id;
  }

  const row = {
    org_id: orgId,
    email: normalized,
    lead_name: name ?? null,
    phone: phone ?? null,
    source_2: sourceLabel ?? null,
    form_answers: formAnswers ?? null,
    form_response_url: formResponseUrl ?? null,
    date_added: new Date().toISOString().slice(0, 10),
    source: 'webhook',
  };
  let { data: created, error: insertError } = await supabase
    .from('leads').insert(row).select('id').single();
  if (insertError && /form_answers|form_response_url/.test(insertError.message)) {
    console.warn('leads.form_answers missing — apply supabase/migrations/0004_webhook_fields.sql');
    delete row.form_answers;
    delete row.form_response_url;
    ({ data: created, error: insertError } = await supabase
      .from('leads').insert(row).select('id').single());
  }
  if (insertError) throw new Error(`lead create failed: ${insertError.message}`);
  await syncContactToBookings(created.id, {
    email: normalized,
    lead_name: name ?? null,
    phone: phone ?? null,
  });
  flagIdentityMatches(created.id, orgId).catch((err) =>
    console.warn('flagIdentityMatches:', err.message ?? err));
  return created.id;
}

// Keep denormalized contact fields on bookings in sync with the linked lead.
export async function syncContactToBookings(leadId, { email, lead_name: leadName, phone }) {
  if (!leadId) return;
  const patch = {};
  if (email) patch.email = email;
  if (leadName) patch.lead_name = leadName;
  if (phone) patch.phone = phone;
  if (!Object.keys(patch).length) return;

  const { error } = await supabase.from('bookings').update(patch).eq('lead_id', leadId);
  if (error && /lead_name|column .* email|phone/i.test(error.message)) {
    console.warn('bookings contact columns missing — apply supabase/migrations/0005_booking_contact_fields.sql');
    return;
  }
  if (error) console.warn('syncContactToBookings:', error.message);
}

// Match a UTM value to a sales_reps row by rep_name or email (case-insensitive).
// Convention: put the setter's name/email in utm_source (or utm_content) on the
// Calendly link; put the closer hint in utm_campaign when you use it.
export async function resolveSalesRepId(hint, orgId) {
  if (!hint || typeof hint !== 'string') return null;
  const q = hint.trim().toLowerCase();
  if (!q) return null;

  let query = supabase.from('sales_reps').select('id, rep_name, email').limit(500);
  if (orgId) query = query.eq('org_id', orgId);

  const { data: reps, error } = await query;
  if (error) {
    console.warn('sales_reps lookup failed:', error.message);
    return null;
  }

  const hit = (reps ?? []).find((r) => {
    const name = r.rep_name?.toLowerCase() ?? '';
    const email = r.email?.toLowerCase() ?? '';
    return name === q || email === q || name.includes(q) || email.includes(q);
  });
  return hit?.id ?? null;
}
