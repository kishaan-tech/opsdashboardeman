import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useOrg, scopeToOrg } from '../lib/org.jsx';
import { canWrite } from '../lib/permissions.js';
import DateRangeBar from '../components/DateRangeBar.jsx';
import { daysAgo } from '../lib/metrics.js';

const SUCCESS = new Set(['succeeded', 'paid', 'completed', 'complete', 'success', 'active']);

function isSuccessTx(t) {
  if (!t.status) return Number(t.amount) > 0;
  return SUCCESS.has(String(t.status).toLowerCase());
}

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export default function CashReconcilePage() {
  const { activeOrgId, role } = useOrg();
  const writable = canWrite(role);
  const [range, setRange] = useState(() => ({ start: daysAgo(29), end: new Date() }));
  const [bookings, setBookings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    const from = range?.start ? new Date(range.start) : null;
    const to = range?.end ? new Date(range.end) : null;

    let bq = scopeToOrg(
      supabase.from('bookings').select('id, lead_name, email, cash_collected, start_time'),
      activeOrgId,
    );
    let tq = scopeToOrg(
      supabase.from('transactions').select(
        'id, date, amount, status, booking_id, email, lead_name, transaction_id',
      ),
      activeOrgId,
    );
    if (from && !Number.isNaN(from.getTime())) {
      bq = bq.gte('start_time', from.toISOString());
      tq = tq.gte('date', from.toISOString().slice(0, 10));
    }
    if (to && !Number.isNaN(to.getTime())) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      bq = bq.lte('start_time', end.toISOString());
      tq = tq.lte('date', end.toISOString().slice(0, 10));
    }

    const [b, t] = await Promise.all([bq, tq]);
    if (b.error || t.error) setError((b.error ?? t.error).message);
    else {
      setBookings(b.data || []);
      setTransactions(t.data || []);
    }
    setLoading(false);
  }, [activeOrgId, range]);

  useEffect(() => { load(); }, [load]);

  const successTx = useMemo(
    () => (transactions || []).filter((t) => isSuccessTx(t) && Number(t.amount) > 0),
    [transactions],
  );

  const reconcile = useMemo(() => {
    const sum = (rows, f) => rows.reduce((acc, r) => acc + (Number(r[f]) || 0), 0);
    const linked = successTx.filter((t) => t.booking_id);
    const unlinked = successTx.filter((t) => !t.booking_id);
    const linkedSum = sum(linked, 'amount');
    const unlinkedSum = sum(unlinked, 'amount');
    const bookingCash = sum(bookings, 'cash_collected');
    const txTotal = sum(successTx, 'amount');
    const diff = Math.round((txTotal - bookingCash) * 100) / 100;

    const cashByBooking = new Map();
    for (const t of linked) {
      cashByBooking.set(
        t.booking_id,
        (cashByBooking.get(t.booking_id) || 0) + (Number(t.amount) || 0),
      );
    }
    const mismatchedBookings = [];
    for (const b of bookings) {
      const fromTx = cashByBooking.get(b.id) || 0;
      const fromBooking = Number(b.cash_collected) || 0;
      if (fromTx > 0 && Math.abs(fromTx - fromBooking) > 0.009) {
        mismatchedBookings.push({
          id: b.id,
          label: b.lead_name || b.email || b.id.slice(0, 8),
          bookingCash: fromBooking,
          txCash: fromTx,
          diff: Math.round((fromTx - fromBooking) * 100) / 100,
        });
      }
    }

    return {
      txTotal,
      bookingCash,
      linkedSum,
      unlinkedSum,
      unlinked,
      diff,
      matched: Math.abs(diff) < 0.009 && unlinked.length === 0 && mismatchedBookings.length === 0,
      mismatchedBookings,
      paymentCount: successTx.length,
    };
  }, [successTx, bookings]);

  async function syncBookingCash() {
    if (!activeOrgId || !writable) return;
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const { data: allTx, error: txErr } = await scopeToOrg(
        supabase.from('transactions').select('booking_id, amount, status'),
        activeOrgId,
      );
      if (txErr) throw new Error(txErr.message);

      const sums = new Map();
      for (const t of allTx || []) {
        if (!t.booking_id) continue;
        if (!isSuccessTx(t) || !(Number(t.amount) > 0)) continue;
        sums.set(t.booking_id, (sums.get(t.booking_id) || 0) + Number(t.amount));
      }

      let updated = 0;
      for (const [bookingId, cash] of sums.entries()) {
        const { error: upErr } = await supabase
          .from('bookings')
          .update({ cash_collected: cash, closed: true })
          .eq('id', bookingId)
          .eq('org_id', activeOrgId);
        if (upErr) throw new Error(upErr.message);
        updated += 1;
      }
      setSyncMsg(`Synced cash on ${updated} booking${updated === 1 ? '' : 's'} from linked payments.`);
      await load();
    } catch (err) {
      setError(String(err.message ?? err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line-soft bg-ink-2/95 px-5 py-3 backdrop-blur-sm">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Cash vs transactions</h2>
          <p className="text-[11px] text-mute">
            Verify that cash collected matches payment totals for this workspace.
          </p>
        </div>
        <DateRangeBar range={range} onChange={setRange} />
      </header>

      <div className={`flex-1 space-y-5 overflow-y-auto p-5 ${loading ? 'opacity-60' : ''}`}>
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}
        {syncMsg && (
          <div className="rounded-lg border border-ok/30 bg-ok/10 p-3 text-sm text-ok">
            {syncMsg}
          </div>
        )}

        <section className="rounded-lg border border-line-soft bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Reconciliation</h3>
              <p className="mt-1 text-[11px] text-mute">
                Cash collected on the dashboard is Σ successful payments. This page compares that to
                booking cash fields and lists unlinked or drifted rows.
              </p>
            </div>
            <span className={`chip ${reconcile.matched ? 'bg-ok/20 text-ok' : 'bg-warn/20 text-warn'}`}>
              {reconcile.matched ? 'Matched' : 'Needs review'}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat
              label="Transactions (cash)"
              value={money(reconcile.txTotal)}
              detail={`${reconcile.paymentCount} payments`}
            />
            <MiniStat label="Booking cash fields" value={money(reconcile.bookingCash)} />
            <MiniStat label="Linked payments" value={money(reconcile.linkedSum)} />
            <MiniStat
              label="Unlinked payments"
              value={money(reconcile.unlinkedSum)}
              detail={`${reconcile.unlinked.length} rows`}
              warn={reconcile.unlinked.length > 0}
            />
          </div>

          <p className="mt-3 text-xs text-mute">
            Difference (transactions − booking cash fields):{' '}
            <span className={`font-mono ${Math.abs(reconcile.diff) < 0.01 ? 'text-ok' : 'text-warn'}`}>
              {money(reconcile.diff)}
            </span>
          </p>

          {writable && (
            <button
              type="button"
              disabled={syncing}
              onClick={syncBookingCash}
              className="btn btn-primary mt-3 text-xs"
            >
              {syncing ? 'Syncing…' : 'Sync booking cash from linked payments'}
            </button>
          )}
        </section>

        {reconcile.mismatchedBookings.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-line-soft bg-panel">
            <p className="border-b border-line-soft px-4 py-2.5 text-xs font-medium text-mute">
              Bookings whose cash field ≠ linked payment sum ({reconcile.mismatchedBookings.length})
            </p>
            <ul className="max-h-64 divide-y divide-line-soft overflow-auto text-sm">
              {reconcile.mismatchedBookings.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <a href={`#/entity/bookings/record/${row.id}`} className="text-brand hover:underline">
                    {row.label}
                  </a>
                  <span className="font-mono text-xs text-mute">
                    booking {money(row.bookingCash)} · tx {money(row.txCash)} · Δ {money(row.diff)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {reconcile.unlinked.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-line-soft bg-panel">
            <p className="border-b border-line-soft px-4 py-2.5 text-xs font-medium text-mute">
              Payments with no booking link (still count in cash) — {reconcile.unlinked.length}
            </p>
            <ul className="max-h-64 divide-y divide-line-soft overflow-auto text-sm">
              {reconcile.unlinked.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <span className="truncate text-soft">
                    {t.lead_name || t.email || t.transaction_id || t.id.slice(0, 8)}
                    {t.date ? <span className="ml-2 text-xs text-mute">{t.date}</span> : null}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">{money(t.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && reconcile.matched && (
          <p className="text-sm text-mute">Everything lines up for this date range.</p>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, detail, warn }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${warn ? 'border-warn/40 bg-warn/5' : 'border-line-soft bg-ink-2/40'}`}>
      <p className="text-[10px] font-medium text-mute">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
      {detail && <p className="text-[10px] text-mute">{detail}</p>}
    </div>
  );
}
