// Shared provider catalog (ids, labels, channels).

export const FORMS_PROVIDERS = ['typeform', 'iclosed', 'ghl', 'custom', 'webinarjam'];
export const BOOKINGS_PROVIDERS = ['calendly', 'iclosed'];
export const PAYMENTS_PROVIDERS = ['whop', 'fanbasis'];

export const PROVIDER_META = {
  typeform: { id: 'typeform', label: 'Typeform', channel: 'forms' },
  calendly: { id: 'calendly', label: 'Calendly', channel: 'bookings' },
  iclosed: { id: 'iclosed', label: 'iClosed', channel: 'scheduler' },
  ghl: { id: 'ghl', label: 'GoHighLevel', channel: 'forms' },
  custom: { id: 'custom', label: 'Custom form', channel: 'forms' },
  webinarjam: { id: 'webinarjam', label: 'WebinarJam', channel: 'forms' },
  whop: { id: 'whop', label: 'Whop', channel: 'payments' },
  fanbasis: { id: 'fanbasis', label: 'Fanbasis', channel: 'payments' },
};

/** Normalize DB/API value to a non-empty unique string[]. */
export function asProviderList(value, fallbackOne) {
  let list = [];
  if (Array.isArray(value)) list = value.map(String);
  else if (typeof value === 'string' && value.trim()) list = [value.trim()];
  list = [...new Set(list.filter(Boolean))];
  if (!list.length && fallbackOne) list = [fallbackOne];
  return list;
}

export function hasProvider(list, id) {
  return asProviderList(list).includes(id);
}
