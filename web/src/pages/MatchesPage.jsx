import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import rules from '../config/identity-match.json';
import { useOrg, scopeToOrg } from '../lib/org.jsx';

export default function MatchesPage() {
  const { activeOrgId } = useOrg();
  const [rows, setRows] = useState([]);
  const [leads, setLeads] = useState({});
  const [filter, setFilter] = useState('open');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    let q = scopeToOrg(
      supabase.from('identity_matches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
      activeOrgId,
    );
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
      const { data: leadRows } = await scopeToOrg(
        supabase.from('leads').select('id, lead_name, email, phone').in('id', [...ids]),
        activeOrgId,
      );
      const map = {};
      for (const r of leadRows || []) map[r.id] = r;
      setLeads(map);
    } else setLeads({});
    setLoading(false);
  }, [filter, activeOrgId]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id, status) {
    const { error: err } = await supabase
      .from('identity_matches')
      .update({ status })
      .eq('id', id);
    if (err) setError(err.message);
    else load();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line-soft px-6 pt-6 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Same person</h2>
            <p className="mt-1 text-sm text-mute">
              Possible duplicate leads matched on phone/name across different emails.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="field w-auto"
            >
              <option value="open">open</option>
              <option value="confirmed">confirmed</option>
              <option value="dismissed">dismissed</option>
              <option value="all">all</option>
            </select>
            <button type="button" onClick={load} className="btn">Refresh</button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-mute">
          Rules: phone last {rules.rules?.phone?.compareLastN ?? 10} digits
          {rules.rules?.name?.enabled ? ' · exact normalized name' : ''}
        </p>
      </header>

      {error && (
        <div className="m-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {loading && <p className="text-sm text-mute">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-mute">No matches for this filter.</p>
        )}
        <ul className="space-y-3">
          {rows.map((m) => {
            const a = leads[m.lead_a_id];
            const b = leads[m.lead_b_id];
            return (
              <li key={m.id} className="rounded-2xl border border-line-soft bg-panel-2 p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="font-medium text-fg">
                      {(m.match_on || []).join(' + ') || 'match'} · {m.confidence}
                    </p>
                    <p className="text-xs text-mute">
                      {a?.lead_name || '—'} &lt;{a?.email || m.lead_a_id}&gt;
                      {' · '}
                      {b?.lead_name || '—'} &lt;{b?.email || m.lead_b_id}&gt;
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn text-xs" onClick={() => setStatus(m.id, 'confirmed')}>
                      Confirm
                    </button>
                    <button type="button" className="btn text-xs" onClick={() => setStatus(m.id, 'dismissed')}>
                      Dismiss
                    </button>
                    <button type="button" className="btn text-xs" onClick={() => setStatus(m.id, 'open')}>
                      Reopen
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
