import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import config from '../config/entities.json';

// Renders each relation from entities.json for the open record:
//   belongsTo   -> the parent record (via this row's FK column)
//   hasMany     -> child rows pointing at this record
//   manyToMany  -> rows linked through a junction table
// Every item links to #/entity/<table>/record/<id> for cross-table navigation.
export default function RelatedRecords({ entity, row }) {
  if (!entity.relations?.length) return null;
  return (
    <section className="space-y-3">
      {entity.relations.map((rel) => (
        <Relation key={`${rel.kind}:${rel.table}:${rel.fk ?? rel.junction}`} rel={rel} row={row} />
      ))}
    </section>
  );
}

function Relation({ rel, row }) {
  const target = config.entities.find((e) => e.table === rel.table);
  const [items, setItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await fetchRelated(rel, row, target);
      if (!cancelled) setItems(found);
    })();
    return () => { cancelled = true; };
  }, [rel, row, target]);

  if (!target || items === null) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-line-soft">
      <p className="border-b border-line-soft bg-ink-2 px-3 py-2 text-xs font-medium text-mute">
        {rel.label} <span className="text-mute/70">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="px-3 py-2 text-xs text-mute">none</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {items.slice(0, 8).map((item) => (
            <li key={item.id}>
              <a
                href={`#/entity/${rel.table}/record/${item.id}`}
                className="block truncate px-3 py-2 text-sm text-soft transition hover:bg-elevated hover:text-fg"
              >
                {String(item[target.titleField] ?? item.id)}
              </a>
            </li>
          ))}
          {items.length > 8 && (
            <li className="px-3 py-2 text-xs text-mute">+{items.length - 8} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

async function fetchRelated(rel, row, target) {
  const cols = `id, ${target.titleField}`;
  if (rel.kind === 'belongsTo') {
    if (!row[rel.fk]) return [];
    const { data } = await supabase.from(rel.table).select(cols).eq('id', row[rel.fk]);
    return data ?? [];
  }
  if (rel.kind === 'hasMany') {
    const { data } = await supabase.from(rel.table).select(cols).eq(rel.fk, row.id).limit(100);
    return data ?? [];
  }
  // manyToMany: junction ids first, then the target rows
  const { data: junctionRows } = await supabase.from(rel.junction)
    .select(rel.targetColumn).eq(rel.sourceColumn, row.id).limit(100);
  const ids = (junctionRows ?? []).map((r) => r[rel.targetColumn]);
  if (!ids.length) return [];
  const { data } = await supabase.from(rel.table).select(cols).in('id', ids);
  return data ?? [];
}
