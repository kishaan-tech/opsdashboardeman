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
      <header className="border-b border-line-soft px-6 pt-6 pb-4">
        <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-xl border border-line">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                className={`px-3 py-1.5 text-sm transition ${
                  preset === p.key
                    ? 'bg-brand text-white font-semibold'
                    : 'bg-ink-2 text-soft hover:bg-elevated hover:text-fg'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-mute">or</span>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => { setCustomFrom(e.target.value); setPreset('custom'); }}
            className="field w-auto"
          />
          <span className="text-xs text-mute">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => { setCustomTo(e.target.value); setPreset('custom'); }}
            className="field w-auto"
          />
        </div>
      </header>

      <div className={`flex-1 space-y-6 overflow-y-auto p-6 ${loading ? 'opacity-60' : ''}`}>
        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="Cash collected" value={money(m.cash)} tone="brand" />
          <Stat label="Bookings" value={m.total.toLocaleString()} tone="teal" />
          <Stat label="Show rate" value={pct(m.showRate)} detail={`${m.shows} of ${m.total} showed`} tone="ok" />
          <Stat label="Close rate" value={pct(m.closeRate)} detail={`${m.closes} of ${m.shows} shows closed`} tone="coral" />
          <Stat label="Revenue generated" value={money(m.revenue)} tone="brand" />
          <Stat label="Transactions" value={money(m.transactionTotal)} detail={`${transactions.length} payments`} tone="teal" />
        </div>

        <section className="overflow-hidden rounded-2xl border border-line-soft bg-panel-2">
          <p className="border-b border-line-soft px-4 py-3 text-xs font-medium text-mute">
            Weekly breakdown
          </p>
          {weekly.length === 0 ? (
            <p className="px-4 py-8 text-sm text-mute">No bookings in this range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-mute">
                <tr>
                  {['Week of', 'Bookings', 'Shows', 'Closes', 'Show rate', 'Close rate', 'Cash', 'Revenue']
                    .map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {weekly.map((w) => (
                  <tr key={w.week} className="hover:bg-elevated/40">
                    <td className="px-4 py-2.5">{new Date(w.week + 'T00:00:00').toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 tabular-nums">{w.total}</td>
                    <td className="px-4 py-2.5 tabular-nums">{w.shows}</td>
                    <td className="px-4 py-2.5 tabular-nums">{w.closes}</td>
                    <td className="px-4 py-2.5 tabular-nums">{pct(w.total ? (100 * w.shows) / w.total : null)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{pct(w.shows ? (100 * w.closes) / w.shows : null)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{money(w.cash)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{money(w.revenue)}</td>
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

const TONE = {
  brand: 'border-brand/25 bg-gradient-to-br from-brand/10 to-transparent text-brand',
  teal: 'border-teal/25 bg-gradient-to-br from-teal/10 to-transparent text-teal',
  coral: 'border-coral/25 bg-gradient-to-br from-coral/10 to-transparent text-coral',
  ok: 'border-ok/25 bg-gradient-to-br from-ok/10 to-transparent text-ok',
};

function Stat({ label, value, detail, tone = 'brand' }) {
  return (
    <div className={`rounded-2xl border bg-panel-2 p-4 ${TONE[tone] ?? TONE.brand}`}>
      <p className="text-xs font-medium text-mute">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-fg">{value}</p>
      {detail && <p className="mt-1 text-xs text-mute">{detail}</p>}
    </div>
  );
}

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (n) => (n === null || Number.isNaN(n) ? '—' : `${Math.round(n)}%`);
