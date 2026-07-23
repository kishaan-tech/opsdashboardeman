import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { parseInput, toInput } from '../lib/format.js';
import RelatedRecords from './RelatedRecords.jsx';
import PossibleMatches from './PossibleMatches.jsx';

// Slide-over editor for one record: editable fields, read-only provenance
// metadata, and related records across tables.
export default function DetailPanel({ entity, row, onClose, onSaved, onDeleted, readOnly = false }) {
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
    <aside className="flex w-[24rem] shrink-0 flex-col border-l border-line-soft bg-panel-2">
      <header className="flex items-center justify-between border-b border-line-soft px-4 py-3.5">
        <h3 className="truncate text-sm font-semibold tracking-tight">
          {String(row[entity.titleField] ?? row.id)}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-mute transition hover:bg-elevated hover:text-fg"
        >
          ✕
        </button>
      </header>

      {entity.table === 'bookings' && (
        <div className="border-b border-line-soft px-4 py-3">
          <a href={`#/post-call/${row.id}`} className="btn btn-primary inline-flex w-full justify-center text-sm">
            Fill post-call form
          </a>
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <section className="space-y-3">
          {editableColumns(entity).map((c) => (
            <label key={c.name} className="block">
              <span className="mb-1.5 block text-xs font-medium text-mute">{c.label}</span>
              <Field
                column={c}
                value={draft[c.name]}
                onChange={(v) => setDraft((d) => ({ ...d, [c.name]: v }))}
              />
            </label>
          ))}
        </section>

        {row.form_answers && typeof row.form_answers === 'object' && (
          <AnswersBlock title="Typeform details" data={row.form_answers} link={row.form_response_url} />
        )}
        {row.utm && typeof row.utm === 'object' && (
          <AnswersBlock title="UTM / tracking" data={row.utm} />
        )}

        {entity.table === 'leads' && <PossibleMatches leadId={row.id} />}
        {entity.table === 'bookings' && row.lead_id && <PossibleMatches leadId={row.lead_id} />}

        <RelatedRecords entity={entity} row={row} />

        <section className="space-y-1 rounded-xl border border-line-soft bg-ink-2 p-3 text-xs text-mute">
          <Meta label="id" value={row.id} />
          <Meta label="airtable_id" value={row.airtable_id} />
          <Meta label="source" value={row.source} />
          <Meta label="external_id" value={row.external_id} />
          <Meta label="updated" value={row.updated_at && new Date(row.updated_at).toLocaleString()} />
        </section>
      </div>

      <footer className="space-y-2 border-t border-line-soft p-3">
        {status && (
          <p className={`text-xs ${status.kind === 'error' ? 'text-danger' : 'text-ok'}`}>
            {status.msg}
          </p>
        )}
        {readOnly ? (
          <p className="text-center text-xs text-mute">View only</p>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="btn btn-primary flex-1">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={remove}
              className="btn border-danger/40 text-danger hover:bg-danger/10"
            >
              Delete
            </button>
          </div>
        )}
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
    <section className="space-y-2 rounded-xl border border-line-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-mute">{title}</h4>
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="text-xs text-soft underline-offset-2 hover:text-fg hover:underline">
            Open response
          </a>
        )}
      </div>
      <dl className="space-y-2">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-mute">{key}</dt>
            <dd className="break-words text-sm text-soft">
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
  if (column.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value === true || value === 'true'}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-line accent-fg"
      />
    );
  }
  if (column.type === 'json' || (typeof value === 'string' && value.length > 80)) {
    return (
      <textarea
        rows={4}
        value={value ?? ''}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="field font-mono text-xs"
      />
    );
  }
  return (
    <input
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="field"
    />
  );
}

function Meta({ label, value }) {
  if (!value) return null;
  return (
    <p className="truncate">
      <span className="text-mute">{label}:</span>{' '}
      <span className="font-mono text-soft">{value}</span>
    </p>
  );
}
