// Normalize Whop payment webhooks → canonical paymentSchema shape.
// Docs: https://docs.whop.com/developer/guides/webhooks
// Events: payment.succeeded, payment.failed, etc.

import { isFanbasis } from './fanbasis.js';

export function isWhop(body) {
  // Fanbasis also uses type "payment.succeeded" — distinguish first
  if (isFanbasis(body)) return false;
  if (typeof body?.data?.id === 'string' && body.data.id.startsWith('pay_')) return true;
  if (typeof body?.type === 'string' && body.type.startsWith('payment.')) return true;
  return false;
}

function digEmail(data) {
  if (!data || typeof data !== 'object') return undefined;
  return data.email
    ?? data.user?.email
    ?? data.member?.email
    ?? data.membership?.user?.email
    ?? data.metadata?.email
    ?? data.billing_address?.email
    ?? undefined;
}

function digName(data) {
  if (!data || typeof data !== 'object') return undefined;
  return data.name
    ?? data.user?.name
    ?? data.user?.username
    ?? data.member?.name
    ?? data.metadata?.name
    ?? undefined;
}

function digAmount(data) {
  // Prefer major-unit fields; fall back to cents if clearly integer cents.
  if (typeof data.usd_amount === 'number') return data.usd_amount;
  if (typeof data.amount_after_fees === 'number') return data.amount_after_fees;
  if (typeof data.total === 'number') return data.total;
  if (typeof data.amount === 'number') {
    // Whop sometimes sends dollars as float; Stripe-style cents are integers ≥ 100
    // with no decimal — leave as-is when already dollars-like.
    return data.amount;
  }
  if (typeof data.final_amount === 'number') return data.final_amount;
  return 0;
}

function digTotalPrice(data) {
  if (!data || typeof data !== 'object') return undefined;
  const plan = data.plan || data.membership?.plan || data.product?.plan || {};
  const candidates = [
    data.total_price,
    data.plan_price,
    data.product_price,
    data.renewal_price,
    data.list_price,
    plan.renewal_price,
    plan.initial_price,
    plan.price,
    typeof plan.raw_price === 'number' ? plan.raw_price / 100 : null,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
  }
  return undefined;
}

function digSubscriptionFlags(data, type) {
  const t = String(type || '');
  const status = String(data?.status || data?.membership?.status || '').toLowerCase();
  const plan = data?.plan || data?.membership?.plan || {};
  const billing = String(plan.billing_period || plan.interval || plan.base_currency || '').toLowerCase();
  const isRenewal = t.includes('renew')
    || /renew/.test(status)
    || Boolean(data?.is_renewal)
    || Boolean(data?.renewal);
  const isSubscription = isRenewal
    || t.includes('subscription')
    || /renew|subscri|recurring/.test(status)
    || /month|year|week|day|recurring/.test(billing)
    || plan.plan_type === 'renewal'
    || Boolean(data?.subscription_id || data?.membership_id);
  return { is_subscription: isSubscription, is_renewal: isRenewal };
}

function statusFromType(type, dataStatus) {
  if (dataStatus) return String(dataStatus);
  if (typeof type === 'string') {
    if (type.includes('succeeded') || type.includes('paid')) return 'succeeded';
    if (type.includes('failed')) return 'failed';
    if (type.includes('pending')) return 'pending';
    if (type.includes('refund')) return 'refunded';
  }
  return 'succeeded';
}

export function normalizeWhop(body) {
  const data = body.data ?? body;
  const type = body.type ?? '';
  const amount = digAmount(data);
  const totalPrice = digTotalPrice(data);
  const flags = digSubscriptionFlags(data, type);

  return {
    payment_id: data.id || body.id,
    amount,
    status: statusFromType(type, data.status),
    paid_at: data.paid_at || data.created_at || body.timestamp || undefined,
    email: digEmail(data),
    name: digName(data),
    total_price: totalPrice,
    ...flags,
  };
}
