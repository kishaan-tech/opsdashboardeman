import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import DateRangeBar from '../components/DateRangeBar.jsx';
import PerfCharts from '../components/PerfCharts.jsx';
import RepStatsTable from '../components/RepStatsTable.jsx';
import {
  daysAgo,
  getBookingsPerDay,
  getCashPerDay,
  getCashPerWeek,
  calculateRepStats,
} from '../lib/metrics.js';

async function loadAll() {
  const [b, t, r] = await Promise.all([
    supabase.from('bookings').select(
      'id, lead_name, email, email_calendly, start_time, status, set_by, set_by_id, closer_id, showed_up, closed, cash_collected, sales_reps, form_link',
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

export default function PerformancePage() {
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

  const bookingsPerDay = useMemo(() => getBookingsPerDay(bookings, range), [bookings, range]);
  const cashPerWeek = useMemo(() => getCashPerWeek(transactions, range), [transactions, range]);
  const cashPerDay = useMemo(() => getCashPerDay(transactions, range), [transactions, range]);
  const stats = useMemo(
    () => calculateRepStats(reps, bookings, transactions, range),
    [reps, bookings, transactions, range],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line-soft px-6 pt-6 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Performance</h2>
            <p className="mt-1 text-sm text-mute">
              Charts and commission breakdown for the selected period
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
        <PerfCharts
          bookingsPerDay={bookingsPerDay}
          cashPerWeek={cashPerWeek}
          cashPerDay={cashPerDay}
          loading={loading}
        />
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
