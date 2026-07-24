import { isTypeform, normalizeTypeform } from './typeform.js';
import { isCalendly, normalizeCalendly } from './calendly.js';
import { isWhop, normalizeWhop } from './whop.js';
import { isFanbasis, normalizeFanbasis } from './fanbasis.js';
import { isIclosed, normalizeIclosedContact, normalizeIclosedCall, classifyIclosed } from './iclosed.js';
import { isGhl, normalizeGhl } from './ghl.js';
import { isCustomForm, normalizeCustomForm } from './custom.js';
import { isWebinarjam, normalizeWebinarjam } from './webinarjam.js';

// Detect vendor payload and map to our canonical shapes. Already-canonical
// bodies pass through unchanged.

export function normalizeFormPayload(body, sourceHint) {
  const hint = String(sourceHint || '').toLowerCase();

  if (hint === 'iclosed' || (isIclosed(body) && classifyIclosed(body) === 'contact')) {
    try {
      return normalizeIclosedContact(body);
    } catch {
      return body;
    }
  }
  if (hint === 'typeform' || isTypeform(body)) {
    try {
      return isTypeform(body) ? normalizeTypeform(body) : body;
    } catch {
      return body;
    }
  }
  if (hint === 'ghl' || isGhl(body)) {
    try {
      return normalizeGhl(body);
    } catch {
      return body;
    }
  }
  if (hint === 'webinarjam' || hint === 'everwebinar' || isWebinarjam(body)) {
    try {
      return normalizeWebinarjam(body);
    } catch {
      return body;
    }
  }
  if (hint === 'custom' || isCustomForm(body)) {
    try {
      return normalizeCustomForm(body);
    } catch {
      return body;
    }
  }
  return body;
}

export function normalizeBookingPayload(body, sourceHint) {
  if (sourceHint === 'iclosed' || (isIclosed(body) && classifyIclosed(body) === 'call')) {
    try {
      return normalizeIclosedCall(body);
    } catch {
      return body;
    }
  }
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
  if (sourceHint === 'fanbasis' || isFanbasis(body)) {
    try {
      return normalizeFanbasis(body);
    } catch {
      return body;
    }
  }
  if (isWhop(body) || sourceHint === 'whop') {
    try {
      return isWhop(body) ? normalizeWhop(body) : body;
    } catch {
      return body;
    }
  }
  return body;
}
