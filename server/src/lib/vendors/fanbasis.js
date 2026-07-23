// Normalize Fanbasis / Commas payment webhooks → canonical paymentSchema.
// Docs: https://apidocs.fan/#webhooks
// Events: payment.succeeded|failed|expired|canceled, product.purchased,
//         subscription.created|renewed, refund.created, …

const FANBASIS_TYPES = [
  'payment.succeeded',
  'payment.failed',
  'payment.expired',
  'payment.canceled',
  'product.purchased',
  'subscription.created',
  'subscription.renewed',
  'subscription.completed',
  'subscription.canceled',
  'refund.created',
  'dispute.created',
  'dispute.updated',
];

export function isFanbasis(body) {
  if (!body || typeof body !== 'object') return false;
  const data = body.data;
  // Fanbasis payment payloads carry buyer + payment_id (ORD-…)
  if (data?.buyer && (data.payment_id || data.event_type)) return true;
  if (typeof data?.payment_id === 'string' && data.payment_id.startsWith('ORD-')) return true;
  if (typeof body.type === 'string' && FANBASIS_TYPES.includes(body.type)) {
    // Distinguish from Whop (pay_ ids) when type overlaps (payment.*)
    if (typeof data?.id === 'string' && data.id.startsWith('pay_')) return false;
    if (data?.buyer || data?.payment_id || data?.item) return true;
  }
  return false;
}

function digAmount(data) {
  if (!data || typeof data !== 'object') return 0;
  if (typeof data.amount === 'number') return data.amount;
  if (typeof data.total_price === 'number') return data.total_price;
  if (typeof data.product_price === 'number') return data.product_price;
  if (typeof data.unit_price === 'number' && typeof data.quantity === 'number') {
    return data.unit_price * data.quantity;
  }
  if (typeof data.amount_cents === 'number') return data.amount_cents / 100;
  return 0;
}

function digTotalPrice(data) {
  if (!data || typeof data !== 'object') return undefined;
  const item = data.item || data.product || {};
  const candidates = [
    data.total_price,
    data.product_price,
    data.renewal_price,
    data.list_price,
    item.price,
    item.total_price,
    item.renewal_price,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
  }
  return undefined;
}

function statusFromType(type, dataStatus) {
  if (dataStatus) return String(dataStatus);
  const t = String(type || '');
  if (t.includes('succeeded') || t.includes('purchased') || t.includes('renewed') || t === 'subscription.created') {
    return 'succeeded';
  }
  if (t.includes('failed') || t.includes('dispute')) return 'failed';
  if (t.includes('refund')) return 'refunded';
  if (t.includes('expired') || t.includes('canceled') || t.includes('cancelled') || t.includes('completed')) {
    return 'canceled';
  }
  return 'succeeded';
}

export function normalizeFanbasis(body) {
  const data = body.data ?? body;
  const type = body.type ?? data.event_type ?? '';
  const buyer = data.buyer ?? {};

  const paymentId = data.payment_id
    || data.transaction_history_id
    || data.id
    || body.id;

  const t = String(type);
  const isRenewal = t.includes('renewed') || Boolean(data.is_renewal);
  const isSubscription = isRenewal
    || t.includes('subscription')
    || Boolean(data.subscription_id);

  return {
    payment_id: String(paymentId),
    amount: digAmount(data),
    status: statusFromType(type, data.status),
    paid_at: data.created_at || body.created_at || undefined,
    email: buyer.email || data.email || undefined,
    name: buyer.name || data.name || undefined,
    total_price: digTotalPrice(data),
    is_subscription: isSubscription,
    is_renewal: isRenewal,
  };
}
