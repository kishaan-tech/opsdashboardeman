import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// The debugging surface: every inbound webhook event, its status, and the
// exact error if it failed. Replaces spelunking through Zapier task history.
const STATUSES = ['', 'received', 'processed', 'failed', 'skipped'];

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    let q = supabase.from('ingestion_events')
      .select('*').order('received_at', { ascending: false }).limit(200);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) setError(error.message);
    else { setEvents(data); setError(null); }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-neutral-200 bg-white px-6 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ingestion Events</h2>
          <div className="flex items-center gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm">
              {STATUSES.map((s) => <option key={s} value={s}>{s || 'all statuses'}</option>)}
            </select>
            <button onClick={load}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
              Refresh
            </button>
          </div>
        </div>
      </header>

      {error && <div className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Received</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">Event</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Wrote to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {events.map((e) => (
              <Row key={e.id} event={e}
                expanded={expanded === e.id}
                onToggle={() => setExpanded(expanded === e.id ? null : e.id)} />
            ))}
            {!events.length && !error && (
              <tr><td colSpan={5} className="px-4 py-6 text-sm text-neutral-500">
                No events yet. Point a webhook at the ingestion API and it will show up here.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STATUS_STYLE = {
  processed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  received: 'bg-amber-100 text-amber-800',
  skipped: 'bg-neutral-100 text-neutral-600',
};

function Row({ event, expanded, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-neutral-50">
        <td className="px-4 py-2 whitespace-nowrap">{new Date(event.received_at).toLocaleString()}</td>
        <td className="px-4 py-2">{event.source}</td>
        <td className="px-4 py-2">{event.event_type}</td>
        <td className="px-4 py-2">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[event.status] ?? ''}`}>
            {event.status}
          </span>
        </td>
        <td className="px-4 py-2 text-xs text-neutral-500">
          {event.record_table && (
            <a href={`#/entity/${event.record_table}/record/${event.record_id}`}
              onClick={(e) => e.stopPropagation()} className="text-blue-700 hover:underline">
              {event.record_table}
            </a>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-neutral-50">
          <td colSpan={5} className="px-4 py-3">
            {event.error && (
              <p className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 font-mono">
                {event.error}
              </p>
            )}
            <pre className="max-h-64 overflow-auto rounded border border-neutral-200 bg-white p-3 text-xs font-mono">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
