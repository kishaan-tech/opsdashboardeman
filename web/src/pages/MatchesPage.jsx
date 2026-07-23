import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import rules from '../config/identity-match.json';

export default function MatchesPage() {
  const [rows, setRows] = useState([]);
  const [leads, setLeads] = useState({});
  const [filter, setFilter] = useState('open');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase.from('identity_matches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error: err } = await q;
    if (err) {
      setError(err.message);
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(data || []);
    const ids = new Set();
    for (const m of data || []) {
      ids.add(m.lead_a_id);
      ids.add(m.lead_b_id);
    }
    if (ids.size) {
      const { data: leadRows } = await supabase
        .from('leads')
        .select('id, lead_name, email, phone')
        .in('id', [...ids]);
      const map = {};
      for (const r of leadRows || []) map[r.id] = r;
      setLeads(map);
    } else setLeads({});
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id, status) {
    const match = rows.find((m) => m.id === id);
    const { error: err } = await supabase
      .from('identity_matches').update({ status }).eq('id', id);
    if (err) { setError(err.message); return; }
    if (match) {
      await supabase.rpc('refresh_lead_duplicate_flags', {
        p_lead_ids: [match.lead_a_id, match.lead_b_id],
      });
    }
    load();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="space-y-3 border-b border-line-soft px-6 pt-6 pb-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Same-person flags</h2>
          <span className="text-xs text-mute">{rows.length} shown</span>
        </div>
        <p className="max-w-2xl text-sm text-mute">
          Customers who book, apply, or pay with different emails but share a phone
          {rules.rules.name?.enabled ? ' and/or name' : ''} are flagged here.
          Tune rules in <code className="text-xs text-soft">server/src/config/identity-match.json</code>.
        </p>
        <div className="flex gap-2 text-xs">
          {['open', 'confirmed', 'dismissed', 'all'].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-xl px-3 py-1.5 capitalize transition ${
                filter === f
                  ? 'bg-brand font-semibold text-white'
                  : 'bg-elevated text-soft hover:text-fg'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="m-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
          {/does not exist/.test(error) && (
            <p className="mt-1 text-xs text-mute">
              Apply <code>0006_identity_matches.sql</code> in the Supabase SQL editor.
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {loading && <p className="text-sm text-mute">Loading…</p>}
        {!loading && !rows.length && !error && (
          <p className="text-sm text-mute">No matches for this filter.</p>
        )}
        <ul className="max-w-3xl space-y-3">
          {rows.map((m) => {
            const a = leads[m.lead_a_id];
            const b = leads[m.lead_b_id];
            return (
              <li key={m.id} className="rounded-2xl border border-line-soft bg-panel-2 p-4 text-sm">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge>{m.confidence}</Badge>
                  <Badge muted>{(m.match_on || []).join(' + ')}</Badge>
                  <Badge muted>{m.status}</Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <LeadCard lead={a} id={m.lead_a_id} />
                  <LeadCard lead={b} id={m.lead_b_id} />
                </div>
                {m.status === 'open' && (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStatus(m.id, 'confirmed')}
                      className="btn btn-primary text-xs"
                    >
                      Confirm same person
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(m.id, 'dismissed')}
                      className="btn text-xs"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function LeadCard({ lead, id }) {
  return (
    <a
      href={`#/entity/leads/record/${id}`}
      className="block rounded-xl border border-line-soft bg-ink-2 p-3 transition hover:border-line hover:bg-elevated"
    >
      <p className="truncate font-medium text-fg">{lead?.lead_name || '—'}</p>
      <p className="truncate text-xs text-mute">{lead?.email || id}</p>
      {lead?.phone && <p className="mt-1 text-xs text-mute">{lead.phone}</p>}
    </a>
  );
}

function Badge({ children, muted }) {
  return (
    <span
      className={`chip ${
        muted ? 'bg-elevated text-mute' : 'bg-warn/15 text-warn'
      }`}
    >
      {children}
    </span>
  );
}
