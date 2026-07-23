import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import DataTable from '../components/DataTable.jsx';
import FilterBar from '../components/FilterBar.jsx';
import DetailPanel from '../components/DetailPanel.jsx';
import { useOrg, scopeToOrg } from '../lib/org.jsx';
import { canWrite } from '../lib/permissions.js';

const PAGE_SIZE = 50;

export default function EntityPage({ entity, recordId }) {
  const { activeOrgId, role } = useOrg();
  const writable = canWrite(role);
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({}); // { column: value }
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    let q = scopeToOrg(
      supabase.from(entity.table)
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
      activeOrgId,
    );

    const textCols = entity.columns.filter((c) => c.type === 'text').map((c) => c.name);
    if (search.trim() && textCols.length) {
      const needle = search.trim().replace(/[,()]/g, ' ');
      q = q.or(textCols.map((c) => `${c}.ilike.*${needle}*`).join(','));
    }
    for (const [col, val] of Object.entries(filters)) {
      if (val !== '') q = q.eq(col, val);
    }

    const { data, count: total, error } = await q;
    if (error) setError(error.message);
    else { setRows(data); setCount(total ?? 0); }
    setLoading(false);
  }, [entity, page, search, filters, activeOrgId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, filters, activeOrgId]);

  // deep link: #/entity/<table>/record/<id>
  useEffect(() => {
    if (!recordId || !activeOrgId) return;
    scopeToOrg(
      supabase.from(entity.table).select('*').eq('id', recordId),
      activeOrgId,
    ).maybeSingle()
      .then(({ data }) => data && setSelected(data));
  }, [entity.table, recordId, activeOrgId]);

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-line-soft px-6 pt-6 pb-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight">{entity.label}</h2>
            <span className="text-xs text-mute">{count.toLocaleString()} records</span>
          </div>
          <FilterBar
            entity={entity}
            search={search}
            onSearch={setSearch}
            filters={filters}
            onFilters={setFilters}
          />
        </header>

        {error && (
          <div className="m-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
            {/relation .* does not exist/.test(error) && (
              <p className="mt-1 text-xs text-mute">Have you applied the schema migrations to Supabase yet?</p>
            )}
          </div>
        )}

        <div className="flex-1 overflow-auto">
          <DataTable
            entity={entity}
            rows={rows}
            loading={loading}
            selectedId={selected?.id}
            onSelect={setSelected}
          />
        </div>

        <footer className="flex items-center justify-between border-t border-line-soft px-6 py-2.5 text-xs text-mute">
          <span>page {page + 1} / {pages}</span>
          <div className="space-x-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="btn px-2.5 py-1 text-xs"
            >
              ‹ prev
            </button>
            <button
              type="button"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="btn px-2.5 py-1 text-xs"
            >
              next ›
            </button>
          </div>
        </footer>
      </div>

      {selected && (
        <DetailPanel
          entity={entity}
          row={selected}
          readOnly={!writable}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setSelected(updated);
            setRows((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
          }}
          onDeleted={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}
