import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// KPI dashboard: headline numbers computed live from bookings + transactions,
// scoped by the date range picker. All aggregation happens client-side —
// volumes are tiny and it keeps the filter instant.

const PRESETS = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'month', label: 'This month' },
];

function rangeFor(preset, customFrom, customTo) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysAgo = (n) => new Date(startOfDay(now).getTime() - n * 86400000);
  switch (preset) {
    case 'today': return [startOfDay(now), null];
    case '7d': return [daysAgo(7), null];
    case '30d': return [daysAgo(30), null];
    case '90d': return [daysAgo(90), null];
    case 'month': return [new Date(now.getFullYear(), now.getMonth(), 1), null];
    case 'custom': return [
      customFrom ? new Date(customFrom + 'T00:00:00') : null,
      customTo ? new Date(customTo + 'T23:59:59.999') : null,
    ];
    default: return [null, null];
  }
}

export default function DashboardPage() {
  const [preset, setPreset] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [bookings, setBookings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [from, to] = useMemo(
    () => rangeFor(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let bq = supabase.from('bookings')
      .select('start_time, showed_up, closed, cash_collected, revenue_generated')
      .not('start_time', 'is', null);
    let tq = supabase.from('transactions').select('date, amount');
    if (from) { bq = bq.gte('start_time', from.toISOString()); tq = tq.gte('date', from.toISOString().slice(0, 10)); }
    if (to)   { bq = bq.lte('start_time', to.toISOString());   tq = tq.lte('date', to.toISOString().slice(0, 10)); }
    const [b, t] = await Promise.all([bq, tq]);
    if (b.error || t.error) setError((b.error ?? t.error).message);
    else { setBookings(b.data); setTransactions(t.data); }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const m = useMemo(() => {
    const total = bookings.length;
    const shows = bookings.filter((b) => b.showed_up).length;
    const closes = bookings.filter((b) => b.closed).length;
    const sum = (rows, f) => rows.reduce((acc, r) => acc + (Number(r[f]) || 0), 0);
    return {
      total, shows, closes,
      showRate: total ? (100 * shows) / total : null,
      closeRate: shows ? (100 * closes) / shows : null,
      cash: sum(bookings, 'cash_collected'),
      revenue: sum(bookings, 'revenue_generated'),
      transactionTotal: sum(transactions, 'amount'),
    };
  }, [bookings, transactions]);

  const weekly = useMemo(() => {
    const byWeek = new Map();
    for (const b of bookings) {
      const d = new Date(b.start_time);
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      const key = monday.toISOString().slice(0, 10);
      const w = byWeek.get(key) ?? { week: key, total: 0, shows: 0, closes: 0, cash: 0, revenue: 0 };
      w.total++;
      if (b.showed_up) w.shows++;
      if (b.closed) w.closes++;
      w.cash += Number(b.cash_collected) || 0;
      w.revenue += Number(b.revenue_generated) || 0;
      byWeek.set(key, w);
    }
    return [...byWeek.values()].sort((a, b) => b.week.localeCompare(a.week));
  }, [bookings]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-neutral-200 bg-white px-6 pt-5 pb-3">
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded border border-neutral-300 overflow-hidden">
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => setPreset(p.key)}
                className={`px-3 py-1.5 text-sm ${preset === p.key
                  ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700 hover:bg-neutral-100'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-neutral-400">or</span>
          <input type="date" value={customFrom}
            onChange={(e) => { setCustomFrom(e.target.value); setPreset('custom'); }}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm" />
          <span className="text-xs text-neutral-500">to</span>
          <input type="date" value={customTo}
            onChange={(e) => { setCustomTo(e.target.value); setPreset('custom'); }}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        </div>
      </header>

      <div className={`flex-1 overflow-y-auto p-6 space-y-6 ${loading ? 'opacity-60' : ''}`}>
        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="Cash collected" value={money(m.cash)} />
          <Stat label="Bookings" value={m.total.toLocaleString()} />
          <Stat label="Show rate" value={pct(m.showRate)} detail={`${m.shows} of ${m.total} showed`} />
          <Stat label="Close rate" value={pct(m.closeRate)} detail={`${m.closes} of ${m.shows} shows closed`} />
          <Stat label="Revenue generated" value={money(m.revenue)} />
          <Stat label="Transactions" value={money(m.transactionTotal)} detail={`${transactions.length} payments`} />
        </div>

        <section className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
          <p className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-600">
            Weekly breakdown
          </p>
          {weekly.length === 0 ? (
            <p className="px-4 py-6 text-sm text-neutral-500">No bookings in this range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  {['Week of', 'Bookings', 'Shows', 'Closes', 'Show rate', 'Close rate', 'Cash', 'Revenue']
                    .map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {weekly.map((w) => (
                  <tr key={w.week}>
                    <td className="px-4 py-2">{new Date(w.week + 'T00:00:00').toLocaleDateString()}</td>
                    <td className="px-4 py-2">{w.total}</td>
                    <td className="px-4 py-2">{w.shows}</td>
                    <td className="px-4 py-2">{w.closes}</td>
                    <td className="px-4 py-2">{pct(w.total ? (100 * w.shows) / w.total : null)}</td>
                    <td className="px-4 py-2">{pct(w.shows ? (100 * w.closes) / w.shows : null)}</td>
                    <td className="px-4 py-2">{money(w.cash)}</td>
                    <td className="px-4 py-2">{money(w.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, detail }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-neutral-400">{detail}</p>}
    </div>
  );
}

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (n) => (n === null || Number.isNaN(n) ? '—' : `${Math.round(n)}%`);
