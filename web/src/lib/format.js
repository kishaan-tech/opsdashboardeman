// Cell/value formatting shared by the table and detail panel.

export function formatCell(value, type) {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'boolean': return value ? '✓' : '✗';
    case 'datetime': return new Date(value).toLocaleString();
    case 'date': return new Date(value).toLocaleDateString();
    case 'number': return typeof value === 'number' ? value.toLocaleString() : String(value);
    case 'json': {
      const s = JSON.stringify(value);
      return s.length > 80 ? s.slice(0, 77) + '…' : s;
    }
    case 'tags': return Array.isArray(value) ? value.join(', ') : String(value);
    default: {
      const s = String(value);
      return s.length > 120 ? s.slice(0, 117) + '…' : s;
    }
  }
}

// Parse an edited input string back to the DB value for its column type.
export function parseInput(raw, type) {
  if (raw === '' || raw === null || raw === undefined) return null;
  switch (type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error('not a number');
      return n;
    }
    case 'boolean': return Boolean(raw);
    case 'json': return JSON.parse(raw);
    case 'tags': return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    default: return raw;
  }
}

// Initial input string for editing a value of a column type.
export function toInput(value, type) {
  if (value === null || value === undefined) return '';
  if (type === 'json') return JSON.stringify(value, null, 2);
  if (type === 'tags') return Array.isArray(value) ? value.join(', ') : String(value);
  return String(value);
}
