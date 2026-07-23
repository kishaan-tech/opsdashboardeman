import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Search box + per-column value filters. Filterable columns are the short
// text ones (status, stage, type…); their options are the distinct values
// currently in the table.
export default function FilterBar({ entity, search, onSearch, filters, onFilters }) {
  const filterCols = entity.columns
    .filter((c) => c.type === 'text' && /status|stage|type|source|currency|category/i.test(c.name))
    .slice(0, 3);
  const [options, setOptions] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = {};
      for (const col of filterCols) {
        const { data } = await supabase.from(entity.table)
          .select(col.name).not(col.name, 'is', null).limit(1000);
        next[col.name] = [...new Set((data ?? []).map((r) => r[col.name]))].sort();
      }
      if (!cancelled) setOptions(next);
    })();
    return () => { cancelled = true; };
  }, [entity.table]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search…"
        className="field w-72"
      />
      {filterCols.map((col) => (
        <select
          key={col.name}
          value={filters[col.name] ?? ''}
          onChange={(e) => onFilters({ ...filters, [col.name]: e.target.value })}
          className="field w-auto"
        >
          <option value="">{col.label}: all</option>
          {(options[col.name] ?? []).map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      ))}
      {(search || Object.values(filters).some(Boolean)) && (
        <button
          type="button"
          onClick={() => { onSearch(''); onFilters({}); }}
          className="text-xs text-mute transition hover:text-fg"
        >
          clear
        </button>
      )}
    </div>
  );
}
