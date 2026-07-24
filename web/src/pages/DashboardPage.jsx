import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useOrg, scopeToOrg } from '../lib/org.jsx';

// KPI dashboard: headline numbers computed live from bookings + transactions,
// scoped by the date range picker. Cash collected === Σ transactions.amount.

const PRESETS = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'month', label: 'This month' },
];

const SUCCESS = new Set(['succeeded', 'paid', 'completed', 'complete', 'success', 'active']);

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

function isSuccessTx(t) {
  if (!t.status) return Number(t.amount) > 0;
  return SUCCESS.has(String(t.status).toLowerCase());
}

function weekKeyFromDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const { activeOrgId } = useOrg();
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
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    let bq = scopeToOrg(
      supabase.from('bookings')
        .select('id, start_time, showed_up, closed, cash_collected, revenue_generated')
        .not('start_time', 'is', null),
      activeOrgId,
    );
    let tq = scopeToOrg(
      supabase.from('transactions').select('id, date, amount, status'),
      activeOrgId,
    );
    if (from) { bq = bq.gte('start_time', from.toISOString()); tq = tq.gte('date', from.toISOString().slice(0, 10)); }
    if (to)   { bq = bq.lte('start_time', to.toISOString());   tq = tq.lte('date', to.toISOString().slice(0, 10)); }
    const [b, t] = await Promise.all([bq, tq]);
    if (b.error || t.error) setError((b.error ?? t.error).message);
    else { setBookings(b.data); setTransactions(t.data); }
    setLoading(false);
  }, [from, to, activeOrgId]);

  useEffect(() => { load(); }, [load]);

  const successTx = useMemo(
    () => (transactions || []).filter((t) => isSuccessTx(t) && Number(t.amount) > 0),
    [transactions],
  );

  const m = useMemo(() => {
    const total = bookings.length;
    const shows = bookings.filter((b) => b.showed_up).length;
    const closes = bookings.filter((b) => b.closed).length;
    const sum = (rows, f) => rows.reduce((acc, r) => acc + (Number(r[f]) || 0), 0);
    return {
      total, shows, closes,
      showRate: total ? (100 * shows) / total : null,
      closeRate: shows ? (100 * closes) / shows : null,
      // Cash collected is defined as Σ successful transactions (always matches).
      cash: sum(successTx, 'amount'),
      revenue: sum(bookings, 'revenue_generated'),
    };
  }, [bookings, successTx]);

  const weekly = useMemo(() => {
    const byWeek = new Map();
    for (const b of bookings) {
      const key = weekKeyFromDate(b.start_time);
      if (!key) continue;
      const w = byWeek.get(key) ?? { week: key, total: 0, shows: 0, closes: 0, cash: 0, revenue: 0 };
      w.total++;
      if (b.showed_up) w.shows++;
      if (b.closed) w.closes++;
      w.revenue += Number(b.revenue_generated) || 0;
      byWeek.set(key, w);
    }
    for (const t of successTx) {
      const key = weekKeyFromDate(t.date ? `${t.date}T12:00:00` : null);
      if (!key) continue;
      const w = byWeek.get(key) ?? { week: key, total: 0, shows: 0, closes: 0, cash: 0, revenue: 0 };
      w.cash += Number(t.amount) || 0;
      byWeek.set(key, w);
    }
    return [...byWeek.values()].sort((a, b) => b.week.localeCompare(a.week));
  }, [bookings, successTx]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line-soft bg-ink-2/95 px-5 py-3 backdrop-blur-sm">
        <h2 className="text-base font-semibold tracking-tight">Dashboard</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-line">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                className={`px-2.5 py-1 text-xs transition ${
                  preset === p.key
                    ? 'bg-elevated font-semibold text-fg'
                    : 'bg-panel text-soft hover:bg-elevated/80 hover:text-fg'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
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

      <div className={`flex-1 space-y-5 overflow-y-auto p-5 ${loading ? 'opacity-60' : ''}`}>
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <Stat
            label="Cash collected"
            value={money(m.cash)}
            detail={`${successTx.length} payments · same as transactions`}
            tone="brand"
          />
          <Stat label="Bookings" value={m.total.toLocaleString()} tone="teal" />
          <Stat label="Show rate" value={pct(m.showRate)} detail={`${m.shows} of ${m.total} showed`} tone="ok" />
          <Stat label="Close rate" value={pct(m.closeRate)} detail={`${m.closes} of ${m.shows} shows closed`} tone="coral" />
          <Stat label="Revenue generated" value={money(m.revenue)} tone="brand" />
        </div>

        <section className="overflow-hidden rounded-lg border border-line-soft bg-panel">
          <p className="border-b border-line-soft px-4 py-2.5 text-xs font-medium text-mute">
            Weekly breakdown
          </p>
          {weekly.length === 0 ? (
            <p className="px-4 py-8 text-sm text-mute">No bookings or payments in this range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-mute">
                <tr className="border-b border-line-soft bg-panel-2/50">
                  {['Week of', 'Bookings', 'Shows', 'Closes', 'Show rate', 'Close rate', 'Cash', 'Revenue']
                    .map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {weekly.map((w) => (
                  <tr key={w.week} className="hover:bg-elevated/30">
                    <td className="px-4 py-2">{new Date(w.week + 'T00:00:00').toLocaleDateString()}</td>
                    <td className="px-4 py-2 tabular-nums">{w.total}</td>
                    <td className="px-4 py-2 tabular-nums">{w.shows}</td>
                    <td className="px-4 py-2 tabular-nums">{w.closes}</td>
                    <td className="px-4 py-2 tabular-nums">{pct(w.total ? (100 * w.shows) / w.total : null)}</td>
                    <td className="px-4 py-2 tabular-nums">{pct(w.shows ? (100 * w.closes) / w.shows : null)}</td>
                    <td className="px-4 py-2 tabular-nums">{money(w.cash)}</td>
                    <td className="px-4 py-2 tabular-nums">{money(w.revenue)}</td>
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
  brand: 'text-brand',
  teal: 'text-teal',
  coral: 'text-coral',
  ok: 'text-ok',
};

function Stat({ label, value, detail, tone = 'brand' }) {
  return (
    <div className="rounded-lg border border-line-soft bg-panel p-3.5">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[tone] ?? TONE.brand} bg-current`} />
        <p className="text-[11px] font-medium text-mute">{label}</p>
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums text-fg">{value}</p>
      {detail && <p className="mt-1 text-[11px] text-mute">{detail}</p>}
    </div>
  );
}

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (n) => (n === null || Number.isNaN(n) ? '—' : `${Math.round(n)}%`);
