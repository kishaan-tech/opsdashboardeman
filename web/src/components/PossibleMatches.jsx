import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Shows open/confirmed identity matches for a lead (same person, different email).
export default function PossibleMatches({ leadId }) {
  const [matches, setMatches] = useState([]);
  const [leads, setLeads] = useState({});
  const [error, setError] = useState(null);

  async function load() {
    if (!leadId) return;
    setError(null);
    const { data, error: err } = await supabase
      .from('identity_matches')
      .select('*')
      .or(`lead_a_id.eq.${leadId},lead_b_id.eq.${leadId}`)
      .neq('status', 'dismissed')
      .order('confidence', { ascending: true })
      .order('created_at', { ascending: false });
    if (err) {
      if (/does not exist|schema cache/i.test(err.message)) {
        setError('Apply migration 0006_identity_matches.sql to enable duplicate flags.');
      } else setError(err.message);
      setMatches([]);
      return;
    }
    setMatches(data || []);
    const ids = new Set();
    for (const m of data || []) {
      ids.add(m.lead_a_id);
      ids.add(m.lead_b_id);
    }
    ids.delete(leadId);
    if (!ids.size) { setLeads({}); return; }
    const { data: rows } = await supabase
      .from('leads')
      .select('id, lead_name, email, phone')
      .in('id', [...ids]);
    const map = {};
    for (const r of rows || []) map[r.id] = r;
    setLeads(map);
  }

  useEffect(() => { load(); }, [leadId]);

  async function setStatus(id, status) {
    const match = matches.find((m) => m.id === id);
    const { error: err } = await supabase
      .from('identity_matches')
      .update({ status })
      .eq('id', id);
    if (err) { setError(err.message); return; }
    if (match) {
      await supabase.rpc('refresh_lead_duplicate_flags', {
        p_lead_ids: [match.lead_a_id, match.lead_b_id],
      });
    }
    await load();
  }

  if (error) {
    return (
      <section className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        {error}
      </section>
    );
  }
  if (!matches.length) return null;

  return (
    <section className="rounded border border-amber-300 bg-amber-50 p-3 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
        Possible same person
      </h4>
      <p className="text-xs text-amber-800/80">
        Different email, but shared phone and/or name. Confirm or dismiss each pair.
      </p>
      <ul className="space-y-2">
        {matches.map((m) => {
          const otherId = m.lead_a_id === leadId ? m.lead_b_id : m.lead_a_id;
          const other = leads[otherId];
          return (
            <li key={m.id} className="rounded border border-amber-200 bg-white p-2 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <a href={`#/entity/leads/record/${otherId}`}
                  className="font-medium text-neutral-900 hover:underline truncate">
                  {other?.lead_name || other?.email || otherId.slice(0, 8)}
                </a>
                <ConfidenceBadge confidence={m.confidence} status={m.status} />
              </div>
              <p className="text-neutral-600 truncate">{other?.email}</p>
              {other?.phone && <p className="text-neutral-500">☎ {other.phone}</p>}
              <p className="text-neutral-500">
                matched on: {(m.match_on || []).join(' + ') || '—'}
              </p>
              {m.status === 'open' && (
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setStatus(m.id, 'confirmed')}
                    className="rounded bg-neutral-900 px-2 py-1 text-white hover:bg-neutral-700">
                    Confirm same
                  </button>
                  <button type="button" onClick={() => setStatus(m.id, 'dismissed')}
                    className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 hover:bg-neutral-50">
                    Not the same
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ConfidenceBadge({ confidence, status }) {
  const color = confidence === 'high'
    ? 'bg-red-100 text-red-800'
    : confidence === 'medium'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-neutral-100 text-neutral-700';
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${color}`}>
      {status === 'confirmed' ? 'confirmed' : confidence}
    </span>
  );
}
