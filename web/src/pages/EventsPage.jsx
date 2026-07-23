import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useOrg, scopeToOrg } from '../lib/org.jsx';

// The debugging surface: every inbound webhook event, its status, and the
// exact error if it failed. Replaces spelunking through Zapier task history.
const STATUSES = ['', 'received', 'processed', 'failed', 'skipped'];

export default function EventsPage() {
  const { activeOrgId } = useOrg();
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    let q = scopeToOrg(
      supabase.from('ingestion_events')
        .select('*').order('received_at', { ascending: false }).limit(200),
      activeOrgId,
    );
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) setError(error.message);
    else { setEvents(data); setError(null); }
  }, [status, activeOrgId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line-soft px-6 pt-6 pb-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Ingestion Events</h2>
          <div className="flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="field w-auto"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s || 'all statuses'}</option>
              ))}
            </select>
            <button type="button" onClick={load} className="btn">
              Refresh
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="m-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-line-soft bg-panel text-left text-xs uppercase tracking-wide text-mute">
            <tr>
              <th className="px-4 py-3 font-medium">Received</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Event</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Wrote to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {events.map((e) => (
              <Row
                key={e.id}
                event={e}
                expanded={expanded === e.id}
                onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
              />
            ))}
            {!events.length && !error && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-sm text-mute">
                  No events yet. Point a webhook at the ingestion API and it will show up here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STATUS_STYLE = {
  processed: 'bg-ok/15 text-ok',
  failed: 'bg-danger/15 text-danger',
  received: 'bg-warn/15 text-warn',
  skipped: 'bg-elevated text-mute',
};

function Row({ event, expanded, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer transition hover:bg-elevated/50">
        <td className="whitespace-nowrap px-4 py-2.5 text-soft">
          {new Date(event.received_at).toLocaleString()}
        </td>
        <td className="px-4 py-2.5 text-soft">{event.source}</td>
        <td className="px-4 py-2.5 text-soft">{event.event_type}</td>
        <td className="px-4 py-2.5">
          <span className={`chip ${STATUS_STYLE[event.status] ?? 'bg-elevated text-mute'}`}>
            {event.status}
          </span>
        </td>
        <td className="px-4 py-2.5 text-xs text-mute">
          {event.record_table && (
            <a
              href={`#/entity/${event.record_table}/record/${event.record_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-soft underline-offset-2 hover:text-fg hover:underline"
            >
              {event.record_table}
            </a>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-ink-2">
          <td colSpan={5} className="px-4 py-3">
            {event.error && (
              <p className="mb-2 rounded-xl border border-danger/30 bg-danger/10 p-2 font-mono text-xs text-danger">
                {event.error}
              </p>
            )}
            <pre className="max-h-64 overflow-auto rounded-xl border border-line-soft bg-panel p-3 font-mono text-xs text-soft">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
