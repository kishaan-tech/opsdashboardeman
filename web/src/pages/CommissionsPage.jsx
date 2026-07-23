import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import DateRangeBar from '../components/DateRangeBar.jsx';
import RepStatsTable from '../components/RepStatsTable.jsx';
import { daysAgo, calculateRepStats, moneyExact } from '../lib/metrics.js';

async function loadAll() {
  const [b, t, r] = await Promise.all([
    supabase.from('bookings').select(
      'id, lead_name, email, start_time, set_by, set_by_id, closer_id, showed_up, closed, sales_reps',
    ),
    supabase.from('transactions').select(
      'id, amount, date, status, set_by, closed_by, setter_commission, closer_commission, booking_id',
    ),
    supabase.from('sales_reps').select('id, rep_name, role, set, close'),
  ]);
  const err = b.error || t.error || r.error;
  if (err) throw new Error(err.message);
  return { bookings: b.data || [], transactions: t.data || [], reps: r.data || [] };
}

export default function CommissionsPage() {
  const [range, setRange] = useState(() => ({ start: daysAgo(29), end: new Date() }));
  const [bookings, setBookings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [reps, setReps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadAll();
      setBookings(data.bookings);
      setTransactions(data.transactions);
      setReps(data.reps);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(
    () => calculateRepStats(reps, bookings, transactions, range),
    [reps, bookings, transactions, range],
  );

  const totals = useMemo(() => {
    const setter = stats.reduce((s, r) => s + r.setterCommission, 0);
    const closer = stats.reduce((s, r) => s + r.closerCommission, 0);
    return { setter, closer, all: setter + closer };
  }, [stats]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line-soft px-6 pt-6 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Commissions</h2>
            <p className="mt-1 text-sm text-mute">
              {loading
                ? 'Loading…'
                : `${stats.length} active rep${stats.length !== 1 ? 's' : ''} · click a row for transaction breakdown`}
            </p>
          </div>
          <button type="button" onClick={load} className="btn text-xs">Refresh</button>
        </div>
        <div className="mt-4">
          <DateRangeBar range={range} onChange={setRange} />
        </div>
      </header>

      <div className={`flex-1 space-y-6 overflow-y-auto p-6 ${loading ? 'opacity-60' : ''}`}>
        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Total commission" value={moneyExact(totals.all)} />
          <StatCard label="Setter commission" value={moneyExact(totals.setter)} tone="brand" />
          <StatCard label="Closer commission" value={moneyExact(totals.closer)} tone="coral" />
        </div>

        <RepStatsTable
          stats={stats}
          transactions={transactions}
          bookings={bookings}
          loading={loading}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const border =
    tone === 'coral' ? 'border-coral/25 from-coral/10'
      : tone === 'brand' ? 'border-brand/25 from-brand/10'
        : 'border-line-soft from-elevated/40';
  return (
    <div className={`rounded-2xl border bg-gradient-to-br to-transparent bg-panel-2 p-4 ${border}`}>
      <p className="text-xs font-medium text-mute">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}
