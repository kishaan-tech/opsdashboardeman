import { formatCell } from '../lib/format.js';

export default function DataTable({ entity, rows, loading, selectedId, onSelect }) {
  const columns = entity.columns.slice(0, 8);

  if (loading && !rows.length) {
    return <p className="p-6 text-sm text-neutral-500">Loading…</p>;
  }
  if (!rows.length) {
    return <p className="p-6 text-sm text-neutral-500">No records.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-500">
        <tr>
          {columns.map((c) => <th key={c.name} className="px-4 py-2 font-medium">{c.label}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100 bg-white">
        {rows.map((row) => (
          <tr key={row.id} onClick={() => onSelect(row)}
            className={`cursor-pointer hover:bg-neutral-50 ${selectedId === row.id ? 'bg-blue-50' : ''}`}>
            {columns.map((c) => (
              <td key={c.name} className="px-4 py-2 whitespace-nowrap max-w-64 overflow-hidden text-ellipsis">
                {formatCell(row[c.name], c.type)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
