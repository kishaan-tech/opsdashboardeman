// Normalize Calendly invitee webhooks → canonical bookingSchema shape.
// Docs: invitee.created / invitee.canceled payload.tracking carries UTMs.

export function isCalendly(body) {
  return typeof body?.event === 'string'
    && (body.event.startsWith('invitee.') || body.event.startsWith('routing_form_'));
}

function inviteeId(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const parts = uri.split('/').filter(Boolean);
  return parts[parts.length - 1] || uri;
}

function statusFromEvent(event, invitee) {
  if (event === 'invitee.canceled' || invitee?.status === 'canceled') return 'Canceled';
  if (invitee?.no_show) return 'No-Show';
  return 'Scheduled';
}

export function normalizeCalendly(body) {
  const invitee = body.payload ?? body;
  const scheduled = invitee.scheduled_event ?? {};
  const tracking = invitee.tracking ?? {};

  const startsAt = scheduled.start_time
    || invitee.start_time
    || invitee.created_at
    || body.created_at;

  const bookingId = inviteeId(invitee.uri)
    || inviteeId(invitee.event)
    || invitee.email;

  const phone = invitee.text_reminder_number
    || invitee.questions_and_answers?.find((qa) =>
      /phone|mobile|cell/i.test(qa.question ?? ''))?.answer
    || undefined;

  const utm = {
    utm_source: tracking.utm_source ?? null,
    utm_medium: tracking.utm_medium ?? null,
    utm_campaign: tracking.utm_campaign ?? null,
    utm_content: tracking.utm_content ?? null,
    utm_term: tracking.utm_term ?? null,
  };

  return {
    booking_id: String(bookingId),
    starts_at: startsAt,
    status: statusFromEvent(body.event, invitee),
    email: invitee.email,
    name: invitee.name
      || [invitee.first_name, invitee.last_name].filter(Boolean).join(' ')
      || undefined,
    phone,
    event_name: scheduled.name || scheduled.event_type || undefined,
    utm,
  };
}
