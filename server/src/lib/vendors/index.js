import { isTypeform, normalizeTypeform } from './typeform.js';
import { isCalendly, normalizeCalendly } from './calendly.js';
import { isWhop, normalizeWhop } from './whop.js';

// Detect vendor payload and map to our canonical shapes. Already-canonical
// bodies (manual curls / Zapier mappings) pass through unchanged.

export function normalizeFormPayload(body, sourceHint) {
  if (isTypeform(body) || sourceHint === 'typeform') {
    try {
      return isTypeform(body) ? normalizeTypeform(body) : body;
    } catch {
      return body;
    }
  }
  return body;
}

export function normalizeBookingPayload(body, sourceHint) {
  if (isCalendly(body) || sourceHint === 'calendly') {
    try {
      return isCalendly(body) ? normalizeCalendly(body) : body;
    } catch {
      return body;
    }
  }
  return body;
}

export function normalizePaymentPayload(body, sourceHint) {
  if (isWhop(body) || sourceHint === 'whop') {
    try {
      return isWhop(body) ? normalizeWhop(body) : body;
    } catch {
      return body;
    }
  }
  return body;
}
