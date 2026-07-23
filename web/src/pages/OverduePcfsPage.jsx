import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { overduePcfs, repsById } from '../lib/metrics.js';

export default function OverduePcfsPage({ onCount }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, r] = await Promise.all([
        supabase.from('bookings').select(
          'id, lead_name, email, email_calendly, start_time, set_by, set_by_id, closer_id, showed_up, closed, sales_reps, form_link, status',
        ),
        supabase.from('sales_reps').select('id, rep_name'),
      ]);
      if (b.error) throw new Error(b.error.message);
      if (r.error) throw new Error(r.error.message);
      const list = overduePcfs(b.data || [], repsById(r.data || []));
      setRows(list);
      onCount?.(list.length);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, [onCount]);

  useEffect(() => { load(); }, [load]);

  const caughtUp = !loading && !error && rows.length === 0;
  const oldest = rows.length
    ? rows.reduce((min, b) => {
      const t = new Date(b.start_time).getTime();
      return t < min ? t : min;
    }, Infinity)
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line-soft px-6 pt-6 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold tracking-tight">Overdue PCFs</h2>
              {!loading && rows.length > 0 && (
                <span className="chip bg-danger/20 text-danger">{rows.length}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-mute">
              {loading
                ? 'Loading…'
                : caughtUp
                  ? 'All post-call forms are filled in'
                  : `${rows.length} booking${rows.length !== 1 ? 's' : ''} missing post-call forms${
                    oldest && Number.isFinite(oldest)
                      ? ` · oldest ${new Date(oldest).toLocaleDateString()}`
                      : ''
                  }`}
            </p>
          </div>
          <button type="button" onClick={load} className="btn text-xs">Refresh</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}

        {caughtUp ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-line-soft bg-panel-2 py-20">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-ok/15 text-ok text-2xl">
              ✓
            </div>
            <p className="text-lg font-semibold">All caught up</p>
            <p className="mt-1 text-sm text-mute">No overdue post-call forms right now.</p>
          </div>
        ) : (
          <section className="overflow-hidden rounded-2xl border border-line-soft bg-panel-2">
            <div className="border-b border-line-soft px-4 py-3">
              <p className="text-sm font-semibold">Bookings awaiting PCF</p>
              <p className="text-xs text-mute">
                Past start time and Showed Up? still empty · open internal post-call form
              </p>
            </div>
            {loading ? (
              <p className="p-4 text-sm text-mute">Loading…</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-mute">
                  <tr className="border-b border-line-soft">
                    <th className="px-4 py-2.5 font-medium">Lead</th>
                    <th className="px-4 py-2.5 font-medium">Start time</th>
                    <th className="px-4 py-2.5 font-medium">Set by</th>
                    <th className="px-4 py-2.5 font-medium">Closer</th>
                    <th className="px-4 py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {rows.map((b) => (
                    <tr key={b.id} className="hover:bg-elevated/40">
                      <td className="px-4 py-2.5">
                        <a
                          href={`#/entity/bookings/record/${b.id}`}
                          className="font-medium text-fg hover:text-brand"
                        >
                          {b.lead_name || b.email || b.email_calendly || '—'}
                        </a>
                      </td>
                      <td className="px-4 py-2.5 text-soft">
                        {b.start_time ? new Date(b.start_time).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-soft">{b.setByName || '—'}</td>
                      <td className="px-4 py-2.5 text-soft">{b.closerName || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <a href={`#/post-call/${b.id}`} className="btn btn-primary px-3 py-1.5 text-xs">
                          Fill PCF
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
