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
      <header className="border-b border-neutral-200 bg-white px-6 pt-5 pb-3 space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Same-person flags</h2>
          <span className="text-xs text-neutral-500">{rows.length} shown</span>
        </div>
        <p className="text-sm text-neutral-600 max-w-2xl">
          Customers who book, apply, or pay with different emails but share a phone
          {rules.rules.name?.enabled ? ' and/or name' : ''} are flagged here.
          Tune rules in <code className="text-xs">server/src/config/identity-match.json</code>.
        </p>
        <div className="flex gap-2 text-xs">
          {['open', 'confirmed', 'dismissed', 'all'].map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`rounded px-2.5 py-1 capitalize ${
                filter === f ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}>
              {f}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
          {/does not exist/.test(error) && (
            <p className="mt-1 text-xs">Apply <code>0006_identity_matches.sql</code> in the Supabase SQL editor.</p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {loading && <p className="text-sm text-neutral-500">Loading…</p>}
        {!loading && !rows.length && !error && (
          <p className="text-sm text-neutral-500">No matches for this filter.</p>
        )}
        <ul className="space-y-3 max-w-3xl">
          {rows.map((m) => {
            const a = leads[m.lead_a_id];
            const b = leads[m.lead_b_id];
            return (
              <li key={m.id} className="rounded border border-neutral-200 bg-white p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Badge>{m.confidence}</Badge>
                  <Badge muted>{(m.match_on || []).join(' + ')}</Badge>
                  <Badge muted>{m.status}</Badge>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <LeadCard lead={a} id={m.lead_a_id} />
                  <LeadCard lead={b} id={m.lead_b_id} />
                </div>
                {m.status === 'open' && (
                  <div className="flex gap-2 mt-3">
                    <button type="button" onClick={() => setStatus(m.id, 'confirmed')}
                      className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700">
                      Confirm same person
                    </button>
                    <button type="button" onClick={() => setStatus(m.id, 'dismissed')}
                      className="rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
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
    <a href={`#/entity/leads/record/${id}`}
      className="block rounded border border-neutral-100 bg-neutral-50 p-3 hover:border-neutral-300">
      <p className="font-medium text-neutral-900 truncate">{lead?.lead_name || '—'}</p>
      <p className="text-xs text-neutral-600 truncate">{lead?.email || id}</p>
      {lead?.phone && <p className="text-xs text-neutral-500 mt-1">{lead.phone}</p>}
    </a>
  );
}

function Badge({ children, muted }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
      muted ? 'bg-neutral-100 text-neutral-600' : 'bg-amber-100 text-amber-900'
    }`}>
      {children}
    </span>
  );
}
