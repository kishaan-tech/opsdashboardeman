// Vendor payload → canonical shape. Keep in sync with api/src/lib/vendors/.

// ---- Typeform --------------------------------------------------------------
function answerValue(answer: any) {
  if (!answer) return null;
  switch (answer.type) {
    case "text":
    case "email":
    case "url":
    case "date":
    case "file_url":
    case "phone_number":
      return answer[answer.type] ?? answer.text ?? null;
    case "boolean":
      return answer.boolean;
    case "number":
      return answer.number;
    case "choice":
      return answer.choice?.label ?? answer.choice?.other ?? null;
    case "choices":
      return answer.choices?.labels?.join(", ") ?? answer.choices?.other ?? null;
    case "payment":
      return answer.payment
        ? `${answer.payment.amount} ${answer.payment.last4 ?? ""}`.trim()
        : null;
    default:
      return answer.text ?? answer.email ?? answer.number ?? null;
  }
}

function fieldTitle(definition: any, fieldId: string) {
  const field = definition?.fields?.find((f: any) => f.id === fieldId);
  return field?.title?.replace(/<[^>]+>/g, "").trim() || fieldId;
}

export function isTypeform(body: any) {
  return Boolean(body?.form_response || body?.event_type === "form_response");
}

export function normalizeTypeform(body: any) {
  const fr = body.form_response ?? body;
  const definition = fr.definition ?? {};
  const answersArr = fr.answers ?? [];
  let email: string | undefined;
  let name: string | undefined;
  let phone: string | undefined;

  for (const answer of answersArr) {
    const title = (fieldTitle(definition, answer.field?.id) || "").toLowerCase();
    const ref = (answer.field?.ref || "").toLowerCase();
    const value = answerValue(answer);
    if (answer.type === "email" || title.includes("email") || ref.includes("email")) {
      if (typeof value === "string" && value.includes("@")) email = value;
    } else if (answer.type === "phone_number" || title.includes("phone") || ref.includes("phone")) {
      if (value != null) phone = String(value);
    } else if (!name && (title.includes("name") || ref.includes("name")) && typeof value === "string") {
      name = value;
    }
  }
  if (!name) {
    for (const answer of answersArr) {
      if (answer.type === "text" && answer.text) { name = answer.text; break; }
    }
  }

  const hidden = fr.hidden ?? {};
  const resolvedEmail = email
    ?? hidden.email
    ?? hidden.epost
    ?? Object.values(hidden).find((v: any) => typeof v === "string" && v.includes("@")) as string | undefined;

  const answers: Record<string, unknown> = {};
  for (const answer of answersArr) {
    answers[fieldTitle(definition, answer.field?.id)] = answerValue(answer);
  }
  if (Object.keys(hidden).length) answers._hidden = hidden;

  return {
    form_name: definition.title || fr.form_id || "typeform",
    submission_id: fr.token || body.event_id || fr.form_id,
    email: resolvedEmail,
    name: name ?? hidden.name ?? hidden.navn ?? undefined,
    phone: phone ?? hidden.phone ?? hidden.telefon ?? undefined,
    source: `typeform - ${definition.title || fr.form_id || "form"}`,
    answers,
    form_response_url: fr.response_url || undefined,
  };
}

// ---- Calendly --------------------------------------------------------------
export function isCalendly(body: any) {
  return typeof body?.event === "string"
    && (body.event.startsWith("invitee.") || body.event.startsWith("routing_form_"));
}

function inviteeId(uri: string | undefined) {
  if (!uri) return null;
  const parts = uri.split("/").filter(Boolean);
  return parts[parts.length - 1] || uri;
}

export function normalizeCalendly(body: any) {
  const invitee = body.payload ?? body;
  const scheduled = invitee.scheduled_event ?? {};
  const tracking = invitee.tracking ?? {};
  const startsAt = scheduled.start_time || invitee.start_time || invitee.created_at || body.created_at;
  const bookingId = inviteeId(invitee.uri) || inviteeId(invitee.event) || invitee.email;
  const phone = invitee.text_reminder_number
    || invitee.questions_and_answers?.find((qa: any) =>
      /phone|mobile|cell/i.test(qa.question ?? ""))?.answer
    || undefined;

  let status = "Scheduled";
  if (body.event === "invitee.canceled" || invitee?.status === "canceled") status = "Canceled";
  else if (invitee?.no_show) status = "No-Show";

  return {
    booking_id: String(bookingId),
    starts_at: startsAt,
    status,
    email: invitee.email,
    name: invitee.name
      || [invitee.first_name, invitee.last_name].filter(Boolean).join(" ")
      || undefined,
    phone,
    event_name: scheduled.name || scheduled.event_type || undefined,
    utm: {
      utm_source: tracking.utm_source ?? null,
      utm_medium: tracking.utm_medium ?? null,
      utm_campaign: tracking.utm_campaign ?? null,
      utm_content: tracking.utm_content ?? null,
      utm_term: tracking.utm_term ?? null,
    },
  };
}

// ---- Whop ------------------------------------------------------------------
export function isWhop(body: any) {
  if (typeof body?.type === "string" && body.type.startsWith("payment.")) return true;
  if (typeof body?.data?.id === "string" && body.data.id.startsWith("pay_")) return true;
  return false;
}

export function normalizeWhop(body: any) {
  const data = body.data ?? body;
  const type = body.type ?? "";
  const digEmail = (d: any) =>
    d?.email ?? d?.user?.email ?? d?.member?.email ?? d?.membership?.user?.email
    ?? d?.metadata?.email ?? d?.billing_address?.email;
  const digName = (d: any) =>
    d?.name ?? d?.user?.name ?? d?.user?.username ?? d?.member?.name ?? d?.metadata?.name;
  const digAmount = (d: any) =>
    d?.usd_amount ?? d?.amount_after_fees ?? d?.total ?? d?.amount ?? d?.final_amount ?? 0;

  let status = data.status ? String(data.status) : "succeeded";
  if (!data.status && typeof type === "string") {
    if (type.includes("failed")) status = "failed";
    else if (type.includes("pending")) status = "pending";
    else if (type.includes("refund")) status = "refunded";
    else if (type.includes("succeeded") || type.includes("paid")) status = "succeeded";
  }

  return {
    payment_id: data.id || body.id,
    amount: digAmount(data),
    status,
    paid_at: data.paid_at || data.created_at || body.timestamp || undefined,
    email: digEmail(data),
    name: digName(data),
  };
}

export function normalizeFormPayload(body: any, sourceHint?: string | null) {
  if (isTypeform(body) || sourceHint === "typeform") {
    try { return isTypeform(body) ? normalizeTypeform(body) : body; } catch { return body; }
  }
  return body;
}

export function normalizeBookingPayload(body: any, sourceHint?: string | null) {
  if (isCalendly(body) || sourceHint === "calendly") {
    try { return isCalendly(body) ? normalizeCalendly(body) : body; } catch { return body; }
  }
  return body;
}

export function normalizePaymentPayload(body: any, sourceHint?: string | null) {
  if (isWhop(body) || sourceHint === "whop") {
    try { return isWhop(body) ? normalizeWhop(body) : body; } catch { return body; }
  }
  return body;
}
