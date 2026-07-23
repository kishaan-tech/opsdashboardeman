// Normalize iClosed webhooks → canonical form / booking shapes.
// Payload shapes from official docs (developer.iclosed.io) + flexible fallbacks.

const CONTACT_HINTS = [
  'newcontactcreated',
  'contactcreated',
  'contact.created',
  'contactupdated',
  'contact.updated',
  'contactbystatus',
  'contact by status',
  'qualified',
  'disqualified',
];

const CALL_BOOKED_HINTS = [
  'newcallscheduled',
  'callbooked',
  'call.booked',
  'call scheduled',
];

const CALL_CANCEL_HINTS = [
  'callcancelled',
  'call.cancelled',
  'callcanceled',
  'call.canceled',
];

const CALL_RESCHEDULE_HINTS = [
  'callrescheduled',
  'call.rescheduled',
];

const OUTCOME_HINTS = [
  'calloutcome',
  'outcome',
  'outcome.recorded',
  'outcomeadded',
];

const TRANSACTION_HINTS = [
  'transaction',
  'transaction.created',
  'transaction.updated',
];

function norm(s) {
  return String(s || '').toLowerCase().replace(/[_\s-]+/g, '');
}

function triggerBlob(body) {
  const parts = [
    body?.hookType,
    body?.trigger?.id,
    body?.trigger?.name,
    body?.event_name,
    body?.type,
    body?.eventType,
    body?.call_booked_from,
    typeof body?.event === 'string' ? body.event : null,
  ];
  return norm(parts.filter(Boolean).join(' '));
}

function matches(blob, hints) {
  return hints.some((h) => blob.includes(norm(h)));
}

function pick(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function fullName(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return pick(
    obj.name,
    obj.fullName,
    [obj.firstName, obj.lastName].filter(Boolean).join(' '),
    [obj.first_name, obj.last_name].filter(Boolean).join(' '),
  );
}

function firstAssignedName(assigned) {
  if (!assigned) return null;
  if (typeof assigned === 'string') return assigned.trim() || null;
  if (typeof assigned === 'object') {
    const vals = Object.values(assigned);
    for (const v of vals) {
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (v && typeof v === 'object') {
        const n = pick(v.name, v.email, fullName(v));
        if (n) return n;
      }
    }
  }
  return null;
}

function firstAssignedEmail(extended) {
  if (!extended || typeof extended !== 'object') return null;
  for (const v of Object.values(extended)) {
    if (v && typeof v === 'object' && v.email) return String(v.email).trim();
  }
  return null;
}

function asAnswers(raw) {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    const out = {};
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const q = row.question ?? row.name;
      if (q) out[String(q)] = row.answer ?? row.response ?? null;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof raw !== 'object') return undefined;
  const out = {};
  const keys = Object.keys(raw);
  const hasNumbered = keys.some((k) => /^\d+_question$/i.test(k));
  if (hasNumbered) {
    for (const k of keys) {
      const m = /^(\d+)_question$/i.exec(k);
      if (!m) continue;
      const q = raw[k];
      const a = raw[`${m[1]}_response`] ?? raw[`${m[1]}_answer`];
      if (q) out[String(q)] = a ?? null;
    }
    // also keep non-numbered label keys
    for (const k of keys) {
      if (/^\d+_/.test(k)) continue;
      out[k] = raw[k];
    }
    return Object.keys(out).length ? out : undefined;
  }
  return raw;
}

function contactRoot(body) {
  // Prefer explicit contact nest; avoid invitee on call payloads when classifying contacts
  if (body?.contact) return body.contact;
  if (body?.data?.contact) return body.data.contact;
  if (body?.hookType && /contact/i.test(String(body.hookType))) return body;
  if (body?.email || body?.phoneNumber || body?.previewId) return body;
  return body?.invitee || body;
}

function callRoot(body) {
  return body?.event && typeof body.event === 'object' && (body.event.uuid != null || body.event.utc_start_time)
    ? body.event
    : body?.call || body?.data?.event || body?.data?.call || null;
}

function utmFrom(body) {
  const src = body?.tracking && typeof body.tracking === 'object' ? body.tracking : body;
  return {
    utm_source: src?.utm_source ?? src?.first_utm_source ?? null,
    utm_medium: src?.utm_medium ?? src?.first_utm_medium ?? null,
    utm_campaign: src?.utm_campaign ?? src?.first_utm_campaign ?? null,
    utm_content: src?.utm_content ?? src?.first_utm_content ?? null,
    utm_term: src?.utm_term ?? src?.first_utm_term ?? null,
  };
}

export function isIclosed(body) {
  if (!body || typeof body !== 'object') return false;
  const blob = triggerBlob(body);
  if (matches(blob, [...CONTACT_HINTS, ...CALL_BOOKED_HINTS, ...CALL_CANCEL_HINTS, ...CALL_RESCHEDULE_HINTS, ...OUTCOME_HINTS, ...TRANSACTION_HINTS])) {
    return true;
  }
  if (body.previewId || body.previewUrl || body.questionsAndAnswers || body.questions_and_responses) return true;
  if (body.invitee?.email && (body.event?.uuid != null || body.event?.utc_start_time)) return true;
  if (body.hookType) return true;
  return false;
}

/**
 * Classify webhook into ingest lane.
 * @returns {'contact'|'call'|'outcome'|'transaction'|'unknown'}
 */
export function classifyIclosed(body) {
  const blob = triggerBlob(body);
  if (matches(blob, OUTCOME_HINTS)) return 'outcome';
  if (matches(blob, TRANSACTION_HINTS)) return 'transaction';
  if (matches(blob, CALL_CANCEL_HINTS) || matches(blob, CALL_RESCHEDULE_HINTS) || matches(blob, CALL_BOOKED_HINTS)) {
    return 'call';
  }
  if (matches(blob, CONTACT_HINTS)) return 'contact';
  // Structural fallbacks
  if (body?.invitee?.email || callRoot(body)?.utc_start_time || callRoot(body)?.uuid != null) return 'call';
  if (contactRoot(body)?.email || contactRoot(body)?.phoneNumber || contactRoot(body)?.id != null) return 'contact';
  return 'unknown';
}

export function normalizeIclosedContact(body) {
  const c = contactRoot(body);
  const contactId = pick(c.id, c.previewId, body.previewId, c.uuid, body.id) || 'unknown';
  const status = pick(c.status, body.status, body.hookType) || 'contact';
  const email = pick(c.email, c.secondary_email, body.email);
  const phone = pick(c.phoneNumber, c.phone, c.secondary_phoneNumber, body.phoneNumber);
  const name = fullName(c) || fullName(body);

  const safeEmail = email
    || (phone ? `phone.${String(phone).replace(/\D/g, '')}@iclosed.invalid` : null)
    || `${String(contactId).replace(/[^a-zA-Z0-9._-]/g, '_')}@iclosed.invalid`;

  const eventName = pick(body.event?.name, body.event_type?.name, c.event?.name);
  const answers = asAnswers(
    c.questionsAndAnswers
    || body.questionsAndAnswers
    || body.questions_and_responses
    || body.questions_and_answers
    || body.question_answers,
  );

  const updated = pick(c.updatedAt, body.updatedAt, c.createdAt, body.createdAt) || new Date().toISOString();

  return {
    form_name: eventName ? `iClosed - ${eventName}` : 'iClosed',
    submission_id: `${contactId}:${status}:${updated}`,
    email: safeEmail,
    name: name || undefined,
    phone: phone || undefined,
    source: `iclosed - ${status}`,
    answers,
    form_response_url: pick(c.previewUrl, body.previewUrl, body.Referrer_Url_Embed) || undefined,
  };
}

export function normalizeIclosedCall(body) {
  const call = callRoot(body) || {};
  const invitee = body.invitee || body.contact || {};
  const setter = call.setter || body.setter || body.setter_data || {};
  const setterPerson = setter.setBy && typeof setter.setBy === 'object' ? setter.setBy : setter;
  const blob = triggerBlob(body);

  const bookingId = pick(
    call.callPreviewId,
    invitee.callPreviewId,
    call.uuid,
    call.id,
    body.callId,
    invitee.uuid,
  );
  if (!bookingId) throw new Error('iclosed call missing uuid');

  const canceled = call.canceled === true
    || invitee.canceled === true
    || matches(blob, CALL_CANCEL_HINTS);

  const startsAt = pick(
    call.utc_start_time,
    call.start_time,
    call.dateTime,
    invitee.utc_start_time,
  );
  if (!startsAt) throw new Error('iclosed call missing start time');

  const email = pick(invitee.email, body.email);
  if (!email) throw new Error('iclosed call missing invitee email');

  const hostEmail = pick(
    call.closerEmail,
    call.email,
    firstAssignedEmail(call.extended_assigned_to),
    body.host?.email,
  );
  const hostName = pick(
    call.closerName,
    firstAssignedName(call.assigned_to),
    firstAssignedName(call.extended_assigned_to),
    fullName(call),
  );
  const setterName = fullName(setterPerson) || pick(setter.name);
  const setterEmail = pick(setterPerson.email, setter.email);

  return {
    booking_id: String(bookingId),
    starts_at: startsAt,
    status: canceled ? 'Canceled' : 'Scheduled',
    email,
    name: fullName(invitee) || undefined,
    phone: pick(invitee.text_reminder_number, invitee.phoneNumber, invitee.phone) || undefined,
    event_name: pick(body.event_type?.name, call.type, body.event?.type) || undefined,
    utm: utmFrom(body),
    setter_hint: setterEmail || setterName || undefined,
    closer_hint: hostEmail || hostName || undefined,
  };
}

/** @returns {{ kind: string, payload?: object, eventType: string, externalId?: string }} */
export function normalizeIclosedWebhook(body) {
  const kind = classifyIclosed(body);
  if (kind === 'contact') {
    const payload = normalizeIclosedContact(body);
    return {
      kind: 'contact',
      payload,
      eventType: 'form.submitted',
      externalId: payload.submission_id,
    };
  }
  if (kind === 'call') {
    const payload = normalizeIclosedCall(body);
    const blob = triggerBlob(body);
    let eventType = 'booking.scheduled';
    if (matches(blob, CALL_CANCEL_HINTS) || payload.status === 'Canceled') {
      eventType = 'booking.canceled';
    } else if (matches(blob, CALL_RESCHEDULE_HINTS)) {
      eventType = 'booking.rescheduled';
    }
    return {
      kind: 'call',
      payload,
      eventType,
      externalId: payload.booking_id,
    };
  }
  if (kind === 'outcome') {
    return {
      kind: 'outcome',
      eventType: 'iclosed.outcome',
      externalId: pick(body.id, body.outcome?.id, body.event?.uuid, `outcome-${Date.now()}`),
      payload: body,
    };
  }
  if (kind === 'transaction') {
    return {
      kind: 'transaction',
      eventType: 'iclosed.transaction',
      externalId: pick(body.id, body.transaction?.id, `txn-${Date.now()}`),
      payload: body,
    };
  }
  return {
    kind: 'unknown',
    eventType: 'iclosed.unknown',
    externalId: pick(body.id, `unknown-${Date.now()}`),
    payload: body,
  };
}
