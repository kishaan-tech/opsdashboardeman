// Supabase Edge Function: the deployed ingestion API.
// Faithful port of api/src (Express) — one function, three endpoints:
//
//   POST https://<ref>.supabase.co/functions/v1/webhooks/forms?source=typeform
//   POST https://<ref>.supabase.co/functions/v1/webhooks/bookings?source=calendly
//   POST https://<ref>.supabase.co/functions/v1/webhooks/payments?source=whop
//
// Deploy with:  supabase functions deploy webhooks --no-verify-jwt
// Secret with:  supabase secrets set WEBHOOK_SECRET=<value from .env>
// (--no-verify-jwt because senders authenticate with x-webhook-secret instead
// of a Supabase JWT. SUPABASE_URL / SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import {
  normalizeFormPayload,
  normalizeBookingPayload,
  normalizePaymentPayload,
} from "./vendors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const dateish = z.string().min(4);

const formSubmissionSchema = z.object({
  form_name: z.string().min(1),
  submission_id: z.string().min(1),
  email: z.string().email(),
  name: z.string().optional(),
  phone: z.string().optional(),
  source: z.string().optional(),
  answers: z.record(z.unknown()).optional(),
  form_response_url: z.string().optional(),
});

const bookingSchema = z.object({
  booking_id: z.string().min(1),
  starts_at: dateish,
  status: z.string().min(1).default("Scheduled"),
  email: z.string().email(),
  name: z.string().optional(),
  phone: z.string().optional(),
  event_name: z.string().optional(),
  utm: z.object({
    utm_source: z.string().nullable().optional(),
    utm_medium: z.string().nullable().optional(),
    utm_campaign: z.string().nullable().optional(),
    utm_content: z.string().nullable().optional(),
    utm_term: z.string().nullable().optional(),
  }).optional(),
});

const paymentSchema = z.object({
  payment_id: z.string().min(1),
  amount: z.coerce.number().nonnegative(),
  status: z.string().min(1).default("succeeded"),
  paid_at: dateish.optional(),
  email: z.string().email().optional(),
  name: z.string().optional(),
});

const SUCCESS_STATUSES = new Set(["succeeded", "paid", "completed", "complete", "success"]);

async function ingest({ source, eventType, externalId, payload, schema, apply }: {
  source: string; eventType: string; externalId?: string; payload: unknown;
  schema: z.ZodTypeAny;
  apply: (data: any, ctx: { source: string; externalId?: string }) => Promise<{ table: string; id: string }>;
}) {
  const { data: event, error: logError } = await supabase
    .from("ingestion_events")
    .insert({ source, event_type: eventType, external_id: externalId ?? null, payload })
    .select("id")
    .single();

  if (logError) {
    if (logError.code === "23505") return json(200, { ok: true, duplicate: true });
    console.error("ingestion_events insert failed:", logError.message);
    return json(500, { ok: false, error: "audit log unavailable" });
  }

  const finalize = (patch: Record<string, unknown>) =>
    supabase.from("ingestion_events")
      .update({ ...patch, processed_at: new Date().toISOString() })
      .eq("id", event.id);

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i: any) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    await finalize({ status: "failed", error: `validation: ${detail}` });
    return json(422, { ok: false, error: detail, event_id: event.id });
  }

  try {
    const { table, id } = await apply(parsed.data, { source, externalId });
    await finalize({ status: "processed", record_table: table, record_id: id });
    return json(200, { ok: true, id, event_id: event.id });
  } catch (err) {
    await finalize({ status: "failed", error: String((err as Error).message ?? err) });
    return json(500, { ok: false, error: String((err as Error).message ?? err), event_id: event.id });
  }
}

async function upsertLead({ email, name, phone, sourceLabel, formAnswers, formResponseUrl }: {
  email: string; name?: string; phone?: string; sourceLabel?: string;
  formAnswers?: Record<string, unknown>; formResponseUrl?: string;
}) {
  const normalized = email.trim().toLowerCase();
  const { data: existing, error: findError } = await supabase
    .from("leads").select("id, lead_name, phone").ilike("email", normalized).maybeSingle();
  if (findError) throw new Error(`lead lookup failed: ${findError.message}`);

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (!existing.lead_name && name) patch.lead_name = name;
    if (!existing.phone && phone) patch.phone = phone;
    if (formAnswers && Object.keys(formAnswers).length) patch.form_answers = formAnswers;
    if (formResponseUrl) patch.form_response_url = formResponseUrl;
    if (Object.keys(patch).length) {
      let { error } = await supabase.from("leads").update(patch).eq("id", existing.id);
      if (error && /form_answers|form_response_url/.test(error.message)) {
        delete patch.form_answers;
        delete patch.form_response_url;
        if (Object.keys(patch).length) {
          ({ error } = await supabase.from("leads").update(patch).eq("id", existing.id));
        } else error = null;
      }
      if (error) throw new Error(`lead update failed: ${error.message}`);
    }
    await syncContactToBookings(existing.id, {
      email: normalized,
      lead_name: (patch.lead_name as string) ?? existing.lead_name ?? name ?? null,
      phone: (patch.phone as string) ?? existing.phone ?? phone ?? null,
    });
    return existing.id;
  }

  const row: Record<string, unknown> = {
    email: normalized,
    lead_name: name ?? null,
    phone: phone ?? null,
    source_2: sourceLabel ?? null,
    form_answers: formAnswers ?? null,
    form_response_url: formResponseUrl ?? null,
    date_added: new Date().toISOString().slice(0, 10),
    source: "webhook",
  };
  let { data: created, error: insertError } = await supabase
    .from("leads").insert(row).select("id").single();
  if (insertError && /form_answers|form_response_url/.test(insertError.message)) {
    delete row.form_answers;
    delete row.form_response_url;
    ({ data: created, error: insertError } = await supabase
      .from("leads").insert(row).select("id").single());
  }
  if (insertError) throw new Error(`lead create failed: ${insertError.message}`);
  await syncContactToBookings(created.id, {
    email: normalized,
    lead_name: name ?? null,
    phone: phone ?? null,
  });
  return created.id;
}

async function syncContactToBookings(
  leadId: string,
  contact: { email?: string | null; lead_name?: string | null; phone?: string | null },
) {
  const patch: Record<string, unknown> = {};
  if (contact.email) patch.email = contact.email;
  if (contact.lead_name) patch.lead_name = contact.lead_name;
  if (contact.phone) patch.phone = contact.phone;
  if (!Object.keys(patch).length) return;
  const { error } = await supabase.from("bookings").update(patch).eq("lead_id", leadId);
  if (error && /lead_name|column .* email|phone/i.test(error.message)) return;
  if (error) console.warn("syncContactToBookings:", error.message);
}

async function resolveSalesRepId(hint?: string | null) {
  if (!hint || typeof hint !== "string") return null;
  const q = hint.trim().toLowerCase();
  if (!q) return null;
  const { data: reps } = await supabase.from("sales_reps").select("id, rep_name, email").limit(500);
  const hit = (reps ?? []).find((r: any) => {
    const name = r.rep_name?.toLowerCase() ?? "";
    const email = r.email?.toLowerCase() ?? "";
    return name === q || email === q || name.includes(q) || email.includes(q);
  });
  return hit?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });

  const url = new URL(req.url);
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret) return json(503, { ok: false, error: "webhook secret not configured" });
  const provided = req.headers.get("x-webhook-secret") ?? url.searchParams.get("secret");
  if (provided !== secret) return json(401, { ok: false, error: "unauthorized" });

  let raw: any;
  try { raw = await req.json(); } catch { return json(400, { ok: false, error: "invalid JSON" }); }

  // pathname ends with /webhooks/<endpoint> or just /<endpoint> depending on gateway
  const parts = url.pathname.split("/").filter(Boolean);
  const endpoint = parts[parts.length - 1];
  const source = url.searchParams.get("source");

  switch (endpoint) {
    case "forms": {
      const payload = normalizeFormPayload(raw, source);
      return ingest({
        source: source ?? "form",
        eventType: "form.submitted",
        externalId: payload?.submission_id,
        payload,
        schema: formSubmissionSchema,
        apply: async (data) => ({
          table: "leads",
          id: await upsertLead({
            email: data.email,
            name: data.name,
            phone: data.phone,
            sourceLabel: data.source ?? data.form_name,
            formAnswers: data.answers,
            formResponseUrl: data.form_response_url,
          }),
        }),
      });
    }

    case "bookings": {
      const payload = normalizeBookingPayload(raw, source);
      return ingest({
        source: source ?? "booking",
        eventType: `booking.${(payload?.status ?? "event").toLowerCase()}`,
        externalId: payload?.booking_id,
        payload,
        schema: bookingSchema,
        apply: async (data, { source: src, externalId }) => {
          const leadId = await upsertLead({
            email: data.email, name: data.name, phone: data.phone, sourceLabel: "booking",
          });
          const { data: lead } = await supabase
            .from("leads").select("lead_name, email, phone").eq("id", leadId).maybeSingle();
          const leadName = data.name || lead?.lead_name || null;
          const email = (data.email || lead?.email || "").toLowerCase() || null;
          const phone = data.phone || lead?.phone || null;

          const utm = data.utm ?? null;
          const setById = await resolveSalesRepId(utm?.utm_source || utm?.utm_content);
          const closerId = await resolveSalesRepId(utm?.utm_campaign);
          const rowPatch: Record<string, unknown> = {
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
            .from("bookings")
            .upsert(rowPatch, { onConflict: "source,external_id" })
            .select("id")
            .single();
          if (error && /(utm|lead_name|\bemail\b|phone)/i.test(error.message)) {
            delete rowPatch.utm;
            delete rowPatch.lead_name;
            delete rowPatch.email;
            delete rowPatch.phone;
            ({ data: row, error } = await supabase
              .from("bookings")
              .upsert(rowPatch, { onConflict: "source,external_id" })
              .select("id")
              .single());
          }
          if (error) throw new Error(error.message);
          return { table: "bookings", id: row.id };
        },
      });
    }

    case "payments": {
      const payload = normalizePaymentPayload(raw, source);
      return ingest({
        source: source ?? "payment",
        eventType: `payment.${(payload?.status ?? "event").toLowerCase()}`,
        externalId: payload?.payment_id,
        payload,
        schema: paymentSchema,
        apply: async (data, { source: src, externalId }) => {
          let bookingId: string | null = null;
          if (data.email) {
            const leadId = await upsertLead({ email: data.email, name: data.name, sourceLabel: "payment" });
            const { data: booking } = await supabase
              .from("bookings").select("id")
              .eq("lead_id", leadId)
              .order("start_time", { ascending: false })
              .limit(1)
              .maybeSingle();
            bookingId = booking?.id ?? null;
          }
          const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
          const { data: row, error } = await supabase
            .from("transactions")
            .upsert({
              source: src,
              external_id: externalId,
              transaction_id: data.payment_id,
              amount: data.amount,
              date: paidAt.toISOString().slice(0, 10),
              status: data.status,
              booking_id: bookingId,
            }, { onConflict: "source,external_id" })
            .select("id")
            .single();
          if (error) throw new Error(error.message);
          if (bookingId && SUCCESS_STATUSES.has(data.status.toLowerCase())) {
            await supabase.from("bookings").update({
              closed: true,
              cash_collected: data.amount,
            }).eq("id", bookingId);
          }
          return { table: "transactions", id: row.id };
        },
      });
    }

    default:
      return json(404, { ok: false, error: `unknown endpoint: ${endpoint}` });
  }
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
