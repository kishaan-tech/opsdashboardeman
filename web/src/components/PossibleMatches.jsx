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
      <section className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
        {error}
      </section>
    );
  }
  if (!matches.length) return null;

  return (
    <section className="space-y-2 rounded-xl border border-warn/25 bg-warn/10 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-warn">
        Possible same person
      </h4>
      <p className="text-xs text-warn/80">
        Different email, but shared phone and/or name. Confirm or dismiss each pair.
      </p>
      <ul className="space-y-2">
        {matches.map((m) => {
          const otherId = m.lead_a_id === leadId ? m.lead_b_id : m.lead_a_id;
          const other = leads[otherId];
          return (
            <li key={m.id} className="space-y-1 rounded-xl border border-line-soft bg-panel p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <a
                  href={`#/entity/leads/record/${otherId}`}
                  className="truncate font-medium text-fg underline-offset-2 hover:underline"
                >
                  {other?.lead_name || other?.email || otherId.slice(0, 8)}
                </a>
                <ConfidenceBadge confidence={m.confidence} status={m.status} />
              </div>
              <p className="truncate text-mute">{other?.email}</p>
              {other?.phone && <p className="text-mute">{other.phone}</p>}
              <p className="text-mute">
                matched on: {(m.match_on || []).join(' + ') || '—'}
              </p>
              {m.status === 'open' && (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setStatus(m.id, 'confirmed')}
                    className="btn btn-primary px-2 py-1 text-[11px]"
                  >
                    Confirm same
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus(m.id, 'dismissed')}
                    className="btn px-2 py-1 text-[11px]"
                  >
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
    ? 'bg-danger/15 text-danger'
    : confidence === 'medium'
      ? 'bg-warn/15 text-warn'
      : 'bg-elevated text-mute';
  return (
    <span className={`chip shrink-0 ${color}`}>
      {status === 'confirmed' ? 'confirmed' : confidence}
    </span>
  );
}
