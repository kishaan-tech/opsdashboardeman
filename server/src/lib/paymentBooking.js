// Attribute a successful payment onto a booking:
//   cash_collected  = sum of all successful linked transaction amounts
//                     (always matches Σ transactions for that booking)
//   revenue_generated = total plan/deal price for subscriptions/renewals; else cash
//   cash_contracted = same as revenue when we know a contracted total

import { supabase } from './supabase.js';

const SUCCESS = new Set(['succeeded', 'paid', 'completed', 'complete', 'success']);

export function isSuccessfulPayment(status) {
  return SUCCESS.has(String(status || '').toLowerCase());
}

export function resolveRevenueAmount({
  amount,
  totalPrice,
  isSubscription,
  isRenewal,
}) {
  const cash = Number(amount) || 0;
  const total = totalPrice != null && totalPrice !== '' ? Number(totalPrice) : null;
  const subLike = Boolean(isSubscription || isRenewal);

  if (subLike && total != null && Number.isFinite(total) && total > 0) return total;
  if (total != null && Number.isFinite(total) && total > cash) return total;
  return cash;
}

export function paymentCashAndRevenue(data) {
  const cash = Number(data.amount) || 0;
  const revenue = resolveRevenueAmount({
    amount: cash,
    totalPrice: data.total_price,
    isSubscription: data.is_subscription,
    isRenewal: data.is_renewal,
  });
  return {
    cash_collected: cash > 0 ? cash : null,
    revenue_generated: revenue > 0 ? revenue : null,
  };
}

/** Sum successful payment amounts linked to a booking. */
export async function sumBookingCashFromTransactions(bookingId) {
  const { data: txs, error } = await supabase
    .from('transactions')
    .select('amount, status')
    .eq('booking_id', bookingId);
  if (error) throw new Error(error.message);
  let sum = 0;
  for (const t of txs || []) {
    const n = Number(t.amount) || 0;
    if (n <= 0) continue;
    if (!t.status || isSuccessfulPayment(t.status) || /paid|success|complete|active/i.test(String(t.status))) {
      sum += n;
    }
  }
  return sum;
}

/**
 * Apply close / cash / revenue effects on a booking for one payment.
 * cash_collected is always recomputed from linked transactions.
 */
export async function applyPaymentToBooking(bookingId, data) {
  if (!bookingId) return;
  if (!isSuccessfulPayment(data.status)) return;

  const cash = Number(data.amount) || 0;
  if (cash <= 0 && !(Number(data.total_price) > 0)) return;

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, closed, cash_collected, revenue_generated, cash_contracted, payment_type')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!booking) return;

  const isSub = Boolean(data.is_subscription || data.is_renewal);
  const revenue = resolveRevenueAmount({
    amount: cash,
    totalPrice: data.total_price,
    isSubscription: data.is_subscription,
    isRenewal: data.is_renewal,
  });

  const cashFromTx = await sumBookingCashFromTransactions(bookingId);
  const patch = {
    closed: true,
    cash_collected: cashFromTx > 0 ? cashFromTx : (cash > 0 ? cash : booking.cash_collected),
  };

  // Revenue = total subscription/deal price when known; never shrink existing.
  const prevRev = Number(booking.revenue_generated) || 0;
  if (revenue > prevRev) {
    patch.revenue_generated = revenue;
  }

  const prevContract = Number(booking.cash_contracted) || 0;
  const contract = Number(data.total_price) > 0 ? Number(data.total_price) : revenue;
  if (contract > prevContract) {
    patch.cash_contracted = contract;
  }

  if (isSub && !booking.payment_type) {
    patch.payment_type = 'subscription';
  } else if (
    !booking.payment_type
    && cash > 0
    && Number(data.total_price) > cash
  ) {
    patch.payment_type = 'deposit';
  } else if (
    !booking.payment_type
    && cash > 0
    && (data.total_price == null || Number(data.total_price) <= cash)
  ) {
    patch.payment_type = 'pif';
    patch.pif = true;
  }

  const { error: upErr } = await supabase
    .from('bookings')
    .update(patch)
    .eq('id', bookingId);
  if (upErr) throw new Error(upErr.message);
}
