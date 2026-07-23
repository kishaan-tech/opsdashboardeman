// Map native vendor CSV exports → canonical form / booking / payment payloads.
// Headers vary by export UI; matching is fuzzy (case/punctuation-insensitive).

import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';

function normKey(k) {
  return String(k || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildIndex(row) {
  const idx = new Map();
  for (const [k, v] of Object.entries(row || {})) {
    const nk = normKey(k);
    if (!nk) continue; // skip "#" / punctuation-only headers
    idx.set(nk, { key: k, value: v });
  }
  return idx;
}

/** Exact-ish header match against aliases; returns trimmed string or ''. */
export function cell(row, ...aliases) {
  const idx = buildIndex(row);
  for (const alias of aliases) {
    const hit = idx.get(normKey(alias));
    if (hit != null && hit.value != null && String(hit.value).trim() !== '') {
      return String(hit.value).trim();
    }
  }
  // Partial: alias contained in header (e.g. "Invitee Email" ↔ "email")
  for (const alias of aliases) {
    const a = normKey(alias);
    if (a.length < 3) continue;
    for (const [nk, hit] of idx.entries()) {
      if (nk.length < 3) continue;
      // Prefer header containing alias ("What is your name?" ↔ name),
      // not alias containing a short header fragment.
      if (nk.includes(a) && hit.value != null && String(hit.value).trim()) {
        return String(hit.value).trim();
      }
    }
  }
  return '';
}

function findEmailInRow(row) {
  const direct = cell(
    row,
    'email',
    'invitee email',
    'email address',
    'user email',
    'customer email',
    'buyer email',
    'member email',
  );
  if (direct.includes('@')) return direct.toLowerCase();

  for (const [k, v] of Object.entries(row || {})) {
    const nk = normKey(k);
    const s = String(v ?? '').trim();
    if (!s.includes('@')) continue;
    if (nk.includes('email') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      return s.toLowerCase();
    }
  }
  return '';
}

function findNameInRow(row) {
  // Whop payments export uses "Customer name"
  const preferred = cell(
    row,
    'customer name',
    'invitee name',
    'full name',
    'user name',
    'member name',
    'buyer name',
  );
  if (preferred) return preferred;
  const first = cell(row, 'invitee first name', 'first name', 'firstname');
  const last = cell(row, 'invitee last name', 'last name', 'lastname');
  const joined = [first, last].filter(Boolean).join(' ').trim();
  if (joined) return joined;
  const idx = buildIndex(row);
  const exact = idx.get('name');
  if (exact?.value && String(exact.value).trim()) return String(exact.value).trim();
  return '';
}

function findPhoneInRow(row) {
  return cell(
    row,
    'phone',
    'phone number',
    'mobile',
    'text reminder number',
    'invitee phone',
  );
}

function parseAmount(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const cleaned = String(raw).replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pick cash amount from a Whop Payments CSV (or similar).
 * Real Whop export columns: "Payment Amount", "Subtotal", "Total Amount USD (…)".
 * Never treat Refunded/Reversed/Fee/Tax amounts as the payment.
 */
function pickAmountFromRow(row) {
  const idx = buildIndex(row);
  const preferredExact = [
    'payment amount',
    'subtotal',
    'amount excluding tax',
    'total amount usd including fees',
    'total amount including fees',
    'total amount usd excluding fees',
    'usd amount',
    'usd_amount',
    'final amount',
    'amount received',
    'amount paid',
    'gross amount',
    'net amount',
    'price',
    'total spend',
    'revenue',
  ];
  for (const alias of preferredExact) {
    const hit = idx.get(normKey(alias));
    if (!hit) continue;
    if (/refund|reversed|fee|tax|discount|credit|defaulted|processing/i.test(String(hit.key || ''))) {
      continue;
    }
    const n = parseAmount(hit.value);
    if (n != null && n > 0) return n;
  }

  const candidates = [];
  for (const [k, v] of Object.entries(row || {})) {
    const nk = normKey(k);
    if (!nk) continue;
    if (/refund|reversed|fee|tax|discount|credit|processing|tip|defaulted|promo/.test(nk)) continue;
    if (!/(paymentamount|subtotal|amountexcluding|totalamount|usdamount|gross|spend|price|revenue|amountpaid|amountreceived)/.test(nk)
      && nk !== 'amount'
      && nk !== 'total'
      && nk !== 'paid') {
      continue;
    }
    // Bare "amount" / "total" only if exact header — avoid "Refunded amount"
    if ((nk === 'amount' || nk === 'total' || nk === 'paid') && normKey(k) !== nk) continue;
    const n = parseAmount(v);
    if (n == null || n <= 0) continue;
    let score = 0;
    if (/paymentamount/.test(nk)) score += 20;
    if (/subtotal|amountexcludingtax/.test(nk)) score += 15;
    if (/totalamountusdincluding|totalamountincluding/.test(nk)) score += 12;
    if (/usdamount|finalamount|grossamount|amountreceived|amountpaid/.test(nk)) score += 10;
    if (/spend|price|revenue/.test(nk)) score += 4;
    score += Math.min(n / 1000, 5);
    candidates.push({ n, score, k });
  }
  candidates.sort((a, b) => b.score - a.score || b.n - a.n);
  return candidates[0]?.n ?? null;
}

/** Contract / plan total for revenue_generated (subscriptions). */
function pickTotalPriceFromRow(row) {
  const idx = buildIndex(row);
  const preferred = [
    'total price',
    'plan price',
    'product price',
    'renewal price',
    'list price',
    'contract value',
    'deal value',
    'total spend',
    // Whop payments export — gross charged (incl fees) as deal proxy when no plan price
    'total amount usd including fees',
    'total amount including fees',
    'payment amount',
    'subtotal',
  ];
  for (const alias of preferred) {
    const hit = idx.get(normKey(alias));
    if (!hit) continue;
    if (/refund|reversed|fee|tax|discount|defaulted/i.test(String(hit.key || ''))) continue;
    const n = parseAmount(hit.value);
    if (n != null && n > 0) return n;
  }
  return null;
}

function subscriptionFlagsFromRow(row, statusRaw) {
  const billingReason = cell(row, 'billing reason', 'billing_reason');
  const plan = cell(row, 'plan', 'plan name', 'product', 'product name', 'billing period', 'interval', 'description');
  const subStatus = cell(row, 'sub status', 'membership status');
  const blob = `${statusRaw} ${billingReason} ${plan} ${subStatus}`.toLowerCase();
  const isRenewal = /renew|subscription_cycle|billing_cycle/.test(blob);
  const isSubscription = isRenewal
    || /subscri|recurring|renewing|monthly|yearly|annual|weekly|subscription_create/.test(blob)
    || Boolean(cell(row, 'membership id', 'membership_id', 'subscription id', 'subscription_id'));
  return { is_subscription: isSubscription, is_renewal: isRenewal };
}

function hashId(...parts) {
  return createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24);
}

export function parseCsvText(csvText) {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return [];
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}

/** Typeform Results → Responses CSV export → formSubmissionSchema rows. */
export function rowsFromTypeformCsv(rows, { formName } = {}) {
  const meta = new Set([
    'responseid', '#', 'submitdate', 'submittedat', 'startdate', 'landedat',
    'networkid', 'score', 'token', 'formid',
  ].map(normKey));

  const out = [];
  for (const row of rows) {
    const submissionId = cell(row, 'Response ID', '#', 'response_id', 'Token', 'token')
      || hashId('tf', JSON.stringify(row));
    const email = findEmailInRow(row);
    if (!email) {
      out.push({ skip: true, reason: 'missing email', raw: row });
      continue;
    }
    const name = findNameInRow(row);
    const phone = findPhoneInRow(row);
    const answers = {};
    for (const [k, v] of Object.entries(row)) {
      if (meta.has(normKey(k))) continue;
      if (v == null || String(v).trim() === '') continue;
      answers[k] = v;
    }
    const title = formName || cell(row, 'form name', 'Form') || 'typeform';
    out.push({
      payload: {
        form_name: title,
        submission_id: submissionId,
        email,
        name: name || undefined,
        phone: phone || undefined,
        source: `typeform - ${title}`,
        answers,
      },
    });
  }
  return out;
}

/** Calendly Scheduled Events / Meetings CSV export → bookingSchema rows. */
export function rowsFromCalendlyCsv(rows) {
  const out = [];
  for (const row of rows) {
    const email = findEmailInRow(row);
    if (!email) {
      out.push({ skip: true, reason: 'missing email', raw: row });
      continue;
    }
    const startsAt = cell(
      row,
      'start date & time',
      'start time',
      'event start time',
      'start date',
      'starts at',
      'meeting start time',
    );
    if (!startsAt || Number.isNaN(Date.parse(startsAt))) {
      out.push({ skip: true, reason: 'missing/invalid start time', raw: row });
      continue;
    }

    const bookingId = cell(
      row,
      'invitee uuid',
      'invitee uri',
      'event uuid',
      'event uri',
      'booking id',
      'meeting uuid',
    ) || hashId('cal', email, startsAt);

    const canceledRaw = cell(row, 'canceled', 'cancelled', 'user canceled', 'status');
    let status = 'Scheduled';
    if (/^(true|yes|1)$/i.test(canceledRaw) || /^cancel/i.test(canceledRaw)) {
      status = 'Canceled';
    } else if (/no.?show/i.test(canceledRaw)) {
      status = 'No-Show';
    } else if (
      !canceledRaw
      || /^(false|no|0)$/i.test(canceledRaw)
      || /active|scheduled|confirmed/i.test(canceledRaw)
    ) {
      status = 'Scheduled';
    } else {
      status = canceledRaw;
    }

    out.push({
      payload: {
        booking_id: bookingId,
        starts_at: new Date(startsAt).toISOString(),
        status,
        email,
        name: findNameInRow(row) || undefined,
        phone: findPhoneInRow(row) || undefined,
        event_name: cell(row, 'event type name', 'event name', 'meeting name', 'event type') || undefined,
        utm: {
          utm_source: cell(row, 'utm_source', 'utm source') || null,
          utm_medium: cell(row, 'utm_medium', 'utm medium') || null,
          utm_campaign: cell(row, 'utm_campaign', 'utm campaign') || null,
          utm_content: cell(row, 'utm_content', 'utm content') || null,
          utm_term: cell(row, 'utm_term', 'utm term') || null,
        },
      },
    });
  }
  return out;
}

/** Whop Users / Memberships / Payments CSV export → paymentSchema rows. */
export function rowsFromWhopCsv(rows) {
  const out = [];
  for (const row of rows) {
    const email = findEmailInRow(row);
    const amount = pickAmountFromRow(row);
    if (amount == null) {
      out.push({ skip: true, reason: 'missing amount', raw: row });
      continue;
    }
    // $0 rows (trials / free) — still importable; dashboard can filter.
    const paymentId = cell(
      row,
      'payment id',
      'payment_id',
      'id',
      'membership id',
      'membership_id',
      'invoice id',
      'transaction id',
    ) || hashId('whop', email || 'noemail', String(amount), cell(row, 'created at', 'joined', 'date'));

    const paidAt = cell(
      row,
      'paid at',
      'created at',
      'joined',
      'date joined',
      'membership creation date',
      'created',
      'date',
    ) || undefined;

    const statusRaw = cell(row, 'status', 'payment status', 'membership status', 'sub status') || 'succeeded';
    let status = 'succeeded';
    if (/fail|decline/i.test(statusRaw)) status = 'failed';
    else if (/refund/i.test(statusRaw)) status = 'refunded';
    else if (/pending|open|draft/i.test(statusRaw)) status = 'pending';
    else if (/cancel|churn|left|expired/i.test(statusRaw)) status = 'canceled';
    else if (/succeed|paid|active|complete|joined|renew|one.?time/i.test(statusRaw) || amount > 0) {
      status = 'succeeded';
    } else {
      status = statusRaw;
    }

    if (!email && amount <= 0) {
      out.push({ skip: true, reason: 'missing email and zero amount', raw: row });
      continue;
    }

    const totalPrice = pickTotalPriceFromRow(row);
    const flags = subscriptionFlagsFromRow(row, statusRaw);

    out.push({
      payload: {
        payment_id: paymentId,
        amount,
        status,
        paid_at: paidAt && !Number.isNaN(Date.parse(paidAt))
          ? new Date(paidAt).toISOString()
          : undefined,
        email: email || undefined,
        name: findNameInRow(row) || undefined,
        total_price: totalPrice ?? undefined,
        ...flags,
      },
    });
  }
  return out;
}

export const CSV_VENDORS = {
  typeform: { channel: 'forms', source: 'typeform', mapRows: rowsFromTypeformCsv },
  calendly: { channel: 'bookings', source: 'calendly', mapRows: rowsFromCalendlyCsv },
  whop: { channel: 'payments', source: 'whop', mapRows: rowsFromWhopCsv },
};
