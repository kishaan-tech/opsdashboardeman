// Normalize Whop payment webhooks → canonical paymentSchema shape.
// Docs: https://docs.whop.com/developer/guides/webhooks
// Events: payment.succeeded, payment.failed, etc.

export function isWhop(body) {
  if (typeof body?.type === 'string' && body.type.startsWith('payment.')) return true;
  if (typeof body?.data?.id === 'string' && body.data.id.startsWith('pay_')) return true;
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

  return {
    payment_id: data.id || body.id,
    amount: digAmount(data),
    status: statusFromType(type, data.status),
    paid_at: data.paid_at || data.created_at || body.timestamp || undefined,
    email: digEmail(data),
    name: digName(data),
  };
}
