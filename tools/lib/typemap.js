// Airtable field type -> Postgres column type.
// Computed fields (formula/rollup/lookup) are migrated as value snapshots of
// their result type — recompute them in Postgres (views/generated columns) if
// they need to stay live.

const SCALAR_TYPES = {
  singleLineText: 'text',
  multilineText: 'text',
  richText: 'text',
  email: 'text',
  url: 'text',
  phoneNumber: 'text',
  singleSelect: 'text',
  barcode: 'text',
  singleCollaborator: 'text',
  createdBy: 'text',
  lastModifiedBy: 'text',
  multipleSelects: 'text[]',
  multipleCollaborators: 'text[]',
  number: 'numeric',
  percent: 'numeric',
  currency: 'numeric(12,2)',
  rating: 'integer',
  duration: 'numeric',
  count: 'integer',
  autoNumber: 'integer',
  checkbox: 'boolean',
  date: 'date',
  dateTime: 'timestamptz',
  createdTime: 'timestamptz',
  lastModifiedTime: 'timestamptz',
  multipleAttachments: 'jsonb',
  button: 'jsonb',
  externalSyncSource: 'text',
  aiText: 'text',
};

export function pgTypeFor(field) {
  if (SCALAR_TYPES[field.type]) return SCALAR_TYPES[field.type];
  // formula / rollup expose the type they evaluate to
  const resultType = field.options?.result?.type;
  if ((field.type === 'formula' || field.type === 'rollup') && SCALAR_TYPES[resultType]) {
    return SCALAR_TYPES[resultType];
  }
  if (field.type === 'multipleLookupValues') return 'jsonb';
  return 'jsonb'; // unknown/future types: keep the raw value rather than drop it
}

// "Deal Stage (2024)" -> "deal_stage_2024"; guaranteed non-empty, no leading digit
export function toPgName(name) {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
  const safe = slug || 'field';
  return /^\d/.test(safe) ? `f_${safe}` : safe;
}

// Column names every table gets regardless of the Airtable schema.
export const RESERVED_COLUMNS = new Set([
  'id', 'airtable_id', 'source', 'external_id', 'created_at', 'updated_at',
]);

// Coerce an Airtable cell value (API or CSV string) to what Postgres expects.
export function coerceValue(value, pgType) {
  if (value === undefined || value === null || value === '') return null;
  const base = pgType.replace(/\(.*\)/, '');
  switch (base) {
    case 'boolean':
      return typeof value === 'boolean' ? value : ['true', '1', 'checked', 'yes'].includes(String(value).toLowerCase());
    case 'numeric':
    case 'integer': {
      const n = Number(String(value).replace(/[$,]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'text[]':
      return Array.isArray(value) ? value.map(String) : String(value).split(',').map((s) => s.trim()).filter(Boolean);
    case 'jsonb':
      return typeof value === 'string' ? tryJson(value) : value;
    case 'date':
    case 'timestamptz': {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

function tryJson(s) {
  try { return JSON.parse(s); } catch { return { value: s }; }
}
