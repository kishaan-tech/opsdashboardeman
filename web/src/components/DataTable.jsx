import { formatCell } from '../lib/format.js';

export default function DataTable({ entity, rows, loading, selectedId, onSelect }) {
  const columns = entity.columns.slice(0, 8);

  if (loading && !rows.length) {
    return <p className="p-6 text-sm text-mute">Loading…</p>;
  }
  if (!rows.length) {
    return <p className="p-6 text-sm text-mute">No records.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 border-b border-line-soft bg-panel text-left text-xs uppercase tracking-wide text-mute">
        <tr>
          {columns.map((c) => (
            <th key={c.name} className="px-4 py-3 font-medium">{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line-soft">
        {rows.map((row) => (
          <tr
            key={row.id}
            onClick={() => onSelect(row)}
            className={`cursor-pointer transition ${
              selectedId === row.id
                ? 'bg-brand/10'
                : 'hover:bg-elevated/50'
            }`}
          >
            {columns.map((c) => (
              <td key={c.name} className="max-w-64 overflow-hidden text-ellipsis whitespace-nowrap px-4 py-2.5 text-soft">
                {c.name === 'possible_duplicate' && row.possible_duplicate
                  ? <span className="chip bg-warn/15 text-warn">flagged</span>
                  : formatCell(row[c.name], c.type)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
