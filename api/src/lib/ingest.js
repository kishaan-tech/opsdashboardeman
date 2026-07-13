// The one code path every inbound event goes through:
//
//   1. log the raw payload to ingestion_events (status: received)
//   2. validate with the route's Zod schema
//   3. apply the domain writes (idempotent — replays update, never duplicate)
//   4. mark the event processed / failed — the error message lands on the
//      event row, so debugging is "open the Events page", not guessing.

import { supabase } from './supabase.js';

export async function ingest({ source, eventType, externalId, payload, schema, apply }) {
  // 1. audit log first — even garbage payloads leave a trace
  const { data: event, error: logError } = await supabase
    .from('ingestion_events')
    .insert({ source, event_type: eventType, external_id: externalId ?? null, payload })
    .select('id')
    .single();

  if (logError) {
    if (logError.code === '23505') {
      // same delivery already seen — idempotent replay
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    console.error('ingestion_events insert failed:', logError.message);
    return { status: 500, body: { ok: false, error: 'audit log unavailable' } };
  }

  const finalize = (patch) =>
    supabase.from('ingestion_events')
      .update({ ...patch, processed_at: new Date().toISOString() })
      .eq('id', event.id);

  // 2. validate
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    await finalize({ status: 'failed', error: `validation: ${detail}` });
    return { status: 422, body: { ok: false, error: detail, event_id: event.id } };
  }

  // 3. domain writes
  try {
    const { table, id } = await apply(parsed.data, { source, externalId });
    await finalize({ status: 'processed', record_table: table, record_id: id });
    return { status: 200, body: { ok: true, id, event_id: event.id } };
  } catch (err) {
    await finalize({ status: 'failed', error: String(err.message ?? err) });
    return { status: 500, body: { ok: false, error: String(err.message ?? err), event_id: event.id } };
  }
}

// Find-or-create a lead by email so every inbound event attaches to a real
// lead row — no floating records. Fills in name/phone if the existing row is
// missing them. Returns the lead id.
export async function upsertLead({ email, name, phone, sourceLabel }) {
  const normalized = email.trim().toLowerCase();

  const { data: existing, error: findError } = await supabase
    .from('leads').select('id, lead_name, phone').ilike('email', normalized).maybeSingle();
  if (findError) throw new Error(`lead lookup failed: ${findError.message}`);

  if (existing) {
    const patch = {};
    if (!existing.lead_name && name) patch.lead_name = name;
    if (!existing.phone && phone) patch.phone = phone;
    if (Object.keys(patch).length) {
      await supabase.from('leads').update(patch).eq('id', existing.id);
    }
    return existing.id;
  }

  const { data: created, error: insertError } = await supabase
    .from('leads')
    .insert({
      email: normalized,
      lead_name: name ?? null,
      phone: phone ?? null,
      source_2: sourceLabel ?? null,
      date_added: new Date().toISOString().slice(0, 10),
      source: 'webhook',
    })
    .select('id')
    .single();
  if (insertError) throw new Error(`lead create failed: ${insertError.message}`);
  return created.id;
}
