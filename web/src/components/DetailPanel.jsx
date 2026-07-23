import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { parseInput, toInput } from '../lib/format.js';
import RelatedRecords from './RelatedRecords.jsx';
import PossibleMatches from './PossibleMatches.jsx';

// Slide-over editor for one record: editable fields, read-only provenance
// metadata, and related records across tables.
export default function DetailPanel({ entity, row, onClose, onSaved, onDeleted }) {
  const [draft, setDraft] = useState({});
  const [status, setStatus] = useState(null); // {kind: 'ok'|'error', msg}
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const initial = {};
    for (const c of editableColumns(entity)) initial[c.name] = toInput(row[c.name], c.type);
    setDraft(initial);
    setStatus(null);
  }, [entity, row]);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const patch = {};
      for (const c of editableColumns(entity)) {
        patch[c.name] = c.type === 'boolean' ? draft[c.name] : parseInput(draft[c.name], c.type);
      }
      const { data, error } = await supabase.from(entity.table)
        .update(patch).eq('id', row.id).select('*').single();
      if (error) throw new Error(error.message);
      onSaved(data);
      setStatus({ kind: 'ok', msg: 'Saved' });
    } catch (err) {
      setStatus({ kind: 'error', msg: String(err.message ?? err) });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete this ${entity.label.replace(/s$/, '').toLowerCase()} record?`)) return;
    const { error } = await supabase.from(entity.table).delete().eq('id', row.id);
    if (error) setStatus({ kind: 'error', msg: error.message });
    else onDeleted();
  }

  return (
    <aside className="w-96 shrink-0 border-l border-neutral-200 bg-white flex flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h3 className="font-semibold text-sm truncate">
          {String(row[entity.titleField] ?? row.id)}
        </h3>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">✕</button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* editable fields */}
        <section className="space-y-3">
          {editableColumns(entity).map((c) => (
            <label key={c.name} className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-500">{c.label}</span>
              <Field column={c} value={draft[c.name]}
                onChange={(v) => setDraft((d) => ({ ...d, [c.name]: v }))} />
            </label>
          ))}
        </section>

        {/* Typeform / UTM read-only blocks */}
        {row.form_answers && typeof row.form_answers === 'object' && (
          <AnswersBlock title="Typeform details" data={row.form_answers} link={row.form_response_url} />
        )}
        {row.utm && typeof row.utm === 'object' && (
          <AnswersBlock title="UTM / tracking" data={row.utm} />
        )}

        {entity.table === 'leads' && <PossibleMatches leadId={row.id} />}
        {entity.table === 'bookings' && row.lead_id && <PossibleMatches leadId={row.lead_id} />}

        <RelatedRecords entity={entity} row={row} />

        {/* provenance — read-only */}
        <section className="rounded border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500 space-y-1">
          <Meta label="id" value={row.id} />
          <Meta label="airtable_id" value={row.airtable_id} />
          <Meta label="source" value={row.source} />
          <Meta label="external_id" value={row.external_id} />
          <Meta label="updated" value={row.updated_at && new Date(row.updated_at).toLocaleString()} />
        </section>
      </div>

      <footer className="border-t border-neutral-200 p-3 space-y-2">
        {status && (
          <p className={`text-xs ${status.kind === 'error' ? 'text-red-600' : 'text-green-600'}`}>
            {status.msg}
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={save} disabled={saving}
            className="flex-1 rounded bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={remove}
            className="rounded border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            Delete
          </button>
        </div>
      </footer>
    </aside>
  );
}

const editableColumns = (entity) =>
  entity.columns.filter((c) =>
    !c.readOnly
    && !['created_at', 'updated_at', 'form_answers', 'form_response_url', 'utm', 'possible_duplicate'].includes(c.name));

function AnswersBlock({ title, data, link }) {
  const entries = Object.entries(data).filter(([k]) => k !== '_hidden');
  if (!entries.length) return null;
  return (
    <section className="rounded border border-neutral-200 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h4>
        {link && (
          <a href={link} target="_blank" rel="noreferrer"
            className="text-xs text-blue-600 hover:underline">Open response</a>
        )}
      </div>
      <dl className="space-y-2">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-neutral-400">{key}</dt>
            <dd className="text-sm text-neutral-800 break-words">
              {value === null || value === undefined ? '—'
                : typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Field({ column, value, onChange }) {
  const base = 'w-full rounded border border-neutral-300 px-3 py-1.5 text-sm';
  if (column.type === 'boolean') {
    return <input type="checkbox" checked={value === true || value === 'true'}
      onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />;
  }
  if (column.type === 'json' || (typeof value === 'string' && value.length > 80)) {
    return <textarea rows={4} value={value ?? ''} spellCheck={false}
      onChange={(e) => onChange(e.target.value)} className={`${base} font-mono text-xs`} />;
  }
  return <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base} />;
}

function Meta({ label, value }) {
  if (!value) return null;
  return <p className="truncate"><span className="text-neutral-400">{label}:</span> <span className="font-mono">{value}</span></p>;
}
