// Fallback generator when you don't want to use the Airtable API:
// export each Airtable table as CSV into data/csv/ (filename = table name)
// and run `npm run generate-schema:csv`.
//
// CSV headers carry no type or relationship information, so this generator
// infers column types from the data and cannot detect linked-record fields —
// review the emitted SQL and add FKs by hand where needed. Prefer the API
// generator when possible.
//
// Tip: add a formula field `RECORD_ID()` named "airtable_id" to each table
// before exporting so the migration stays idempotent and links can resolve.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { toPgName, RESERVED_COLUMNS } from './lib/typemap.js';
import { emitAll } from './lib/emit.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_DIR = join(ROOT, 'data/csv');

const files = readdirSync(CSV_DIR).filter((f) => f.endsWith('.csv'));
if (!files.length) {
  console.error(`No CSV files found in data/csv/. Export each Airtable table there first.`);
  process.exit(1);
}

const model = { tables: [] };

for (const file of files) {
  const tableName = basename(file, '.csv');
  const rows = parse(readFileSync(join(CSV_DIR, file)), { columns: true, skip_empty_lines: true });
  if (!rows.length) { console.warn(`  ! ${file} is empty, skipping`); continue; }

  const used = new Set(RESERVED_COLUMNS);
  const headers = Object.keys(rows[0]).filter((h) => toPgName(h) !== 'airtable_id');
  const columns = headers.map((h) => ({
    airtableName: h,
    pgName: claim(used, toPgName(h)),
    pgType: inferType(rows.map((r) => r[h])),
    airtableType: 'csv',
  }));

  model.tables.push({
    airtableId: null,
    airtableName: tableName,
    pgName: toPgName(tableName),
    titleField: columns[0]?.pgName ?? 'airtable_id',
    columns,
    links: [], // not derivable from CSV — add FKs manually in the generated SQL
  });
  console.log(`  ${file}: ${rows.length} rows, ${columns.length} columns`);
}

emitAll(model, { generatedBy: 'tools/generate-schema-from-csv.js (CSV mode — types inferred, links not detected)' });
console.log('\nReview the generated SQL — CSV mode cannot detect relationships.');

function inferType(values) {
  const sample = values.filter((v) => v !== '' && v != null).slice(0, 200);
  if (!sample.length) return 'text';
  if (sample.every((v) => /^-?[\d,]+(\.\d+)?$/.test(String(v).replace(/^\$/, '')))) return 'numeric';
  if (sample.every((v) => ['true', 'false', 'checked', ''].includes(String(v).toLowerCase()))) return 'boolean';
  if (sample.every((v) => !Number.isNaN(Date.parse(v)) && /\d{4}/.test(v))) {
    return sample.some((v) => /\d:\d/.test(v)) ? 'timestamptz' : 'date';
  }
  return 'text';
}

function claim(used, name) {
  let candidate = name;
  for (let i = 2; used.has(candidate); i++) candidate = `${name}_${i}`;
  used.add(candidate);
  return candidate;
}
