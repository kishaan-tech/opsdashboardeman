// Bulk-import vendor CSV exports through the same ingest + domain writes as webhooks.

import { supabase } from './supabase.js';
import { ingest, upsertLead, resolveSalesRepId } from './ingest.js';
import { formSubmissionSchema, bookingSchema, paymentSchema } from '../schemas/index.js';
import {
  parseCsvText,
  CSV_VENDORS,
  rowsFromTypeformCsv,
} from './vendors/csv.js';
import { writeAuditLog } from './org.js';
import { applyPaymentToBooking, paymentCashAndRevenue } from './paymentBooking.js';

async function applyForm(data, { orgId }) {
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
}

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

async function applyPayment(data, { source: src, externalId, orgId }) {
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
}

const CHANNEL = {
  forms: {
    schema: formSubmissionSchema,
    apply: applyForm,
    eventType: (p) => 'form.submitted',
    externalId: (p) => p.submission_id,
  },
  bookings: {
    schema: bookingSchema,
    apply: applyBooking,
    eventType: (p) => `booking.${(p?.status ?? 'event').toLowerCase()}`,
    externalId: (p) => p.booking_id,
  },
  payments: {
    schema: paymentSchema,
    apply: applyPayment,
    eventType: (p) => `payment.${(p?.status ?? 'event').toLowerCase()}`,
    externalId: (p) => p.payment_id,
  },
};

/**
 * Import a vendor CSV for an org. Returns summary counts + sample errors.
 */
export async function importVendorCsv({
  orgId,
  vendor,
  csvText,
  formName,
  actorId,
}) {
  const conf = CSV_VENDORS[vendor];
  if (!conf) {
    throw new Error(`unsupported vendor: ${vendor} (use typeform|calendly|whop)`);
  }
  const channel = CHANNEL[conf.channel];
  const rows = parseCsvText(csvText);
  if (!rows.length) {
    throw new Error('CSV has no data rows (check headers / file contents)');
  }

  const mapped = vendor === 'typeform'
    ? rowsFromTypeformCsv(rows, { formName })
    : conf.mapRows(rows);

  const summary = {
    vendor,
    channel: conf.channel,
    source: conf.source,
    rows_total: mapped.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const item of mapped) {
    if (item.skip) {
      summary.skipped += 1;
      if (summary.errors.length < 25) {
        summary.errors.push({ reason: item.reason });
      }
      continue;
    }
    const payload = item.payload;
    const result = await ingest({
      orgId,
      source: conf.source,
      eventType: channel.eventType(payload),
      externalId: channel.externalId(payload),
      payload,
      schema: channel.schema,
      apply: (data, ctx) => channel.apply(data, { ...ctx, orgId }),
    });

    if (result.body?.ok) {
      summary.imported += 1;
    } else if (result.body?.skipped) {
      summary.skipped += 1;
    } else {
      summary.failed += 1;
      if (summary.errors.length < 25) {
        summary.errors.push({
          reason: result.body?.error || `HTTP ${result.status}`,
          external_id: channel.externalId(payload),
        });
      }
    }
  }

  if (actorId) {
    await writeAuditLog({
      actorId,
      orgId,
      action: 'org.csv_import',
      details: {
        vendor,
        imported: summary.imported,
        skipped: summary.skipped,
        failed: summary.failed,
        rows_total: summary.rows_total,
      },
    });
  }

  return summary;
}
