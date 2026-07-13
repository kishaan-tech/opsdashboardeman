// Reads your Airtable base structure via the Metadata API and generates:
//   supabase/migrations/0002_generated_schema.sql
//   tools/generated/schema-map.json
//   web/src/config/entities.json
//
// Usage: npm run generate-schema   (needs AIRTABLE_API_KEY + AIRTABLE_BASE_ID in .env)

import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBaseSchema } from './lib/airtable.js';
import { pgTypeFor, toPgName, RESERVED_COLUMNS } from './lib/typemap.js';
import { emitAll } from './lib/emit.js';

const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error('Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID in .env (see .env.example).');
  process.exit(1);
}

// Optional hand-tuning, keyed by Airtable names (see schema-overrides.json):
//   skipTables: ["Table 1"]              don't migrate these tables at all
//   skipFields: ["Bookings.Email"]       drop individual fields (incl. links)
//   forceFk:    ["Bookings.Lead Name"]   treat a multi-link as single -> FK column
const overridesPath = join(dirname(fileURLToPath(import.meta.url)), 'schema-overrides.json');
const overrides = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, 'utf8'))
  : { skipTables: [], skipFields: [], forceFk: [] };
const skipTables = new Set(overrides.skipTables ?? []);
const skipFields = new Set(overrides.skipFields ?? []);
const forceFk = new Set(overrides.forceFk ?? []);
const renameFields = overrides.renameFields ?? {};
const sourceName = (tableName, f) => renameFields[`${tableName}.${f.name}`] ?? f.name;

console.log(`Fetching schema for base ${AIRTABLE_BASE_ID}…`);
const allTables = await fetchBaseSchema(AIRTABLE_API_KEY, AIRTABLE_BASE_ID);
const tables = allTables.filter((t) => !skipTables.has(t.name));
console.log(`  ${allTables.length} tables: ${allTables.map((t) => t.name).join(', ')}`);
for (const name of skipTables) console.log(`  (skipping "${name}" per schema-overrides.json)`);

// Airtable stores every relationship twice — a link field on each side.
// Index all fields so we can pick exactly one side per relationship.
const fieldIndex = new Map(); // field id -> { field, tableName }
for (const t of tables) {
  for (const f of t.fields) {
    if (!skipFields.has(`${t.name}.${f.name}`)) fieldIndex.set(f.id, { field: f, tableName: t.name });
  }
}

const prefersSingle = ({ field, tableName }) =>
  Boolean(field.options?.prefersSingleRecordLink) || forceFk.has(`${tableName}.${field.name}`);

// Symmetric, deterministic winner: the FK-shaped side if exactly one is, else
// the lexicographically-smaller field id. Both sides compute the same answer.
function isWinningSide(mine, inverseId) {
  const theirs = fieldIndex.get(inverseId);
  if (!theirs) return true; // inverse skipped/hidden — this side carries it
  const m = prefersSingle(mine), th = prefersSingle(theirs);
  if (m !== th) return m;
  return mine.field.id < theirs.field.id;
}

// table id -> pg name (deduped)
const tableNames = dedupeNames(tables.map((t) => toPgName(t.name)));
const pgNameByTableId = Object.fromEntries(tables.map((t, i) => [t.id, tableNames[i]]));

const model = { tables: [] };

for (const t of tables) {
  const pgName = pgNameByTableId[t.id];
  const used = new Set(RESERVED_COLUMNS);
  const columns = [];
  const links = [];
  let titleField = null;

  for (const f of t.fields) {
    if (skipFields.has(`${t.name}.${f.name}`)) {
      console.log(`  (skipping field "${t.name}.${f.name}" per schema-overrides.json)`);
      continue;
    }
    if (f.type === 'multipleRecordLinks') {
      const targetTable = pgNameByTableId[f.options?.linkedTableId];
      if (!targetTable) {
        console.warn(`  ! ${t.name}.${f.name}: linked table not found or skipped, dropping link`);
        continue;
      }
      // one relationship = one link: only the winning side emits it
      const inverseId = f.options?.inverseLinkFieldId;
      if (inverseId && !isWinningSide({ field: f, tableName: t.name }, inverseId)) continue;
      if (prefersSingle({ field: f, tableName: t.name })) {
        const pgColumn = claim(used, ensureIdSuffix(toPgName(sourceName(t.name, f))));
        links.push({ airtableName: f.name, airtableId: f.id, kind: 'fk', pgColumn, targetTable });
      } else {
        const junctionTable = `${pgName}_${toPgName(sourceName(t.name, f))}`;
        const self = targetTable === pgName;
        links.push({
          airtableName: f.name, airtableId: f.id, kind: 'junction', junctionTable, targetTable,
          sourceColumn: self ? 'source_id' : `${pgName}_id`,
          targetColumn: self ? 'target_id' : `${targetTable}_id`,
        });
      }
      continue;
    }
    const col = {
      airtableName: f.name,
      airtableId: f.id,
      pgName: claim(used, toPgName(sourceName(t.name, f))),
      pgType: pgTypeFor(f),
      airtableType: f.type,
    };
    columns.push(col);
    if (f.id === t.primaryFieldId) titleField = col.pgName;
  }

  model.tables.push({
    airtableId: t.id,
    airtableName: t.name,
    pgName,
    titleField: titleField ?? columns[0]?.pgName ?? 'airtable_id',
    columns,
    links,
  });
}

console.log('Generating artifacts…');
emitAll(model, { generatedBy: 'tools/generate-schema.js' });
console.log('\nNext steps:');
console.log('  1. Review supabase/migrations/0002_generated_schema.sql');
console.log('  2. Apply it (Supabase SQL editor or `npx supabase db push`)');
console.log('  3. npm run migrate');

// ---------------------------------------------------------------------------
function dedupeNames(names) {
  const seen = new Map();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : `${n}_${count}`;
  });
}

function claim(used, name) {
  let candidate = name;
  for (let i = 2; used.has(candidate); i++) candidate = `${name}_${i}`;
  used.add(candidate);
  return candidate;
}

function ensureIdSuffix(n) {
  return n.endsWith('_id') ? n : `${n}_id`;
}
