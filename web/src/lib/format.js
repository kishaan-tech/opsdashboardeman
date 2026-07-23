// Cell/value formatting shared by the table and detail panel.

function stringifyShort(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 28 ? s.slice(0, 25) + '…' : s;
}

export function formatCell(value, type) {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'boolean': return value ? '✓' : '✗';
    case 'datetime': return new Date(value).toLocaleString();
    case 'date': return new Date(value).toLocaleDateString();
    case 'number': return typeof value === 'number' ? value.toLocaleString() : String(value);
    case 'json': {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const keys = Object.keys(value).filter((k) => k !== '_hidden');
        if (keys.length) {
          const preview = keys.slice(0, 2).map((k) => `${k}: ${stringifyShort(value[k])}`).join(' · ');
          return keys.length > 2 ? `${preview} · +${keys.length - 2}` : preview;
        }
      }
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
