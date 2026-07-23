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
import { useOrg, scopeToOrg } from '../lib/org.jsx';

async function loadAll(orgId) {
  const [b, t, r] = await Promise.all([
    scopeToOrg(supabase.from('bookings').select(
      'id, lead_name, email, email_calendly, start_time, status, set_by_id, closer_id, showed_up, closed, cash_collected, sales_reps, form_link',
    ), orgId),
    scopeToOrg(supabase.from('transactions').select(
      'id, amount, date, status, set_by, closed_by, setter_commission, closer_commission, booking_id, email, lead_name',
    ), orgId),
    scopeToOrg(supabase.from('sales_reps').select('id, rep_name, role, set, close'), orgId),
  ]);
  const err = b.error || t.error || r.error;
  if (err) throw new Error(err.message);
  return { bookings: b.data || [], transactions: t.data || [], reps: r.data || [] };
}

export default function PerformancePage() {
  const { activeOrgId } = useOrg();
  const [range, setRange] = useState(() => ({ start: daysAgo(29), end: new Date() }));
  const [bookings, setBookings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [reps, setReps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await loadAll(activeOrgId);
      setBookings(data.bookings);
      setTransactions(data.transactions);
      setReps(data.reps);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

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
      <header className="sticky top-0 z-10 space-y-2.5 border-b border-line-soft bg-ink-2/95 px-5 py-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">Performance</h2>
            <p className="text-xs text-mute">
              Charts and commission breakdown for the selected period
            </p>
          </div>
          <button type="button" onClick={load} className="btn text-xs">Refresh</button>
        </div>
        <DateRangeBar range={range} onChange={setRange} />
      </header>

      <div className={`flex-1 space-y-5 overflow-y-auto p-5 ${loading ? 'opacity-60' : ''}`}>
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
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
