// One-shot (but safely re-runnable) migration: Airtable -> Supabase Postgres.
//
//   npm run migrate               pulls records via the Airtable API
//   npm run migrate -- --from-csv reads data/csv/<Table Name>.csv exports instead
//
// Driven entirely by tools/generated/schema-map.json (from the generator), so
// it works for any base. Two passes:
//   1. upsert every record's scalar fields, keyed on airtable_id (idempotent)
//   2. resolve linked-record fields: Airtable rec ids -> our uuids, writing FK
//      columns and junction rows; unresolvable links are reported, not dropped
//      silently.

import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import { fetchAllRecords } from './lib/airtable.js';
import { coerceValue } from './lib/typemap.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FROM_CSV = process.argv.includes('--from-csv');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  fail('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}
if (!FROM_CSV && (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID)) {
  fail('Missing AIRTABLE_API_KEY / AIRTABLE_BASE_ID in .env (or pass --from-csv)');
}

const model = JSON.parse(readFileSync(join(ROOT, 'tools/generated/schema-map.json'), 'utf8'));
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CHUNK = 500;
const stats = { tables: {}, unresolvedLinks: 0 };

// ---------------------------------------------------------------------------
// Pass 1 — load records, upsert scalar fields, remember raw link values
// ---------------------------------------------------------------------------
// linkValues[tablePg] = Map(airtable record id -> { [airtable field name]: raw value })
const linkValues = {};

for (const t of model.tables) {
  console.log(`\n[${t.airtableName}] fetching records…`);
  const records = FROM_CSV ? readCsvRecords(t) : await fetchAirtableRecords(t);
  console.log(`  ${records.length} records`);

  linkValues[t.pgName] = new Map();
  const rows = records.map((rec) => {
    const row = { airtable_id: rec.id, source: 'airtable' };
    for (const col of t.columns) {
      row[col.pgName] = coerceValue(rec.fields[col.airtableName], col.pgType);
    }
    const links = {};
    for (const l of t.links) {
      if (rec.fields[l.airtableName] != null) links[l.airtableName] = rec.fields[l.airtableName];
    }
    if (Object.keys(links).length) linkValues[t.pgName].set(rec.id, links);
    return row;
  });

  for (const chunk of chunks(rows, CHUNK)) {
    const { error } = await supabase.from(t.pgName).upsert(chunk, { onConflict: 'airtable_id' });
    if (error) fail(`upsert into ${t.pgName} failed: ${error.message}`);
  }
  stats.tables[t.pgName] = { records: records.length };
  console.log(`  upserted into ${t.pgName}`);
}

// ---------------------------------------------------------------------------
// Pass 2 — resolve links now that every row exists and has a uuid
// ---------------------------------------------------------------------------
console.log('\nResolving relationships…');

// airtable record id -> our uuid, across all tables (rec ids are globally unique)
const uuidByAirtableId = new Map();
// per-table title -> uuid, for CSV exports that reference records by name
const uuidByTitle = {};

for (const t of model.tables) {
  uuidByTitle[t.pgName] = new Map();
  for await (const row of selectAll(t.pgName, `id, airtable_id, ${quote(t.titleField)}`)) {
    uuidByAirtableId.set(row.airtable_id, row.id);
    const title = row[t.titleField];
    if (title != null) uuidByTitle[t.pgName].set(String(title), row.id);
  }
}

const resolveRef = (raw, targetTable) =>
  uuidByAirtableId.get(raw) ?? uuidByTitle[targetTable]?.get(String(raw)) ?? null;

for (const t of model.tables) {
  if (!t.links.length) continue;
  const fkUpdates = []; // { id, ...fkColumns }
  const junctionRows = {}; // junctionTable -> rows

  for (const [recId, links] of linkValues[t.pgName]) {
    const rowId = uuidByAirtableId.get(recId);
    if (!rowId) continue;
    const update = { id: rowId, airtable_id: recId };
    let touched = false;

    for (const l of t.links) {
      const raw = links[l.airtableName];
      if (raw == null) continue;
      const refs = (Array.isArray(raw) ? raw : String(raw).split(',').map((s) => s.trim()))
        .map((r) => resolveRef(r, l.targetTable))
        .filter((id, i, arr) => id && arr.indexOf(id) === i);
      const rawCount = Array.isArray(raw) ? raw.length : 1;
      if (refs.length < rawCount) {
        stats.unresolvedLinks += rawCount - refs.length;
        console.warn(`  ! ${t.pgName}/${recId} "${l.airtableName}": ${rawCount - refs.length} link(s) unresolved`);
      }
      if (l.kind === 'fk') {
        if (refs[0]) { update[l.pgColumn] = refs[0]; touched = true; }
      } else {
        (junctionRows[l.junctionTable] ??= []).push(
          ...refs.map((ref) => ({ [l.sourceColumn]: rowId, [l.targetColumn]: ref })),
        );
      }
    }
    if (touched) fkUpdates.push(update);
  }

  for (const chunk of chunks(fkUpdates, CHUNK)) {
    const { error } = await supabase.from(t.pgName).upsert(chunk, { onConflict: 'id' });
    if (error) fail(`FK update on ${t.pgName} failed: ${error.message}`);
  }
  for (const [junction, rows] of Object.entries(junctionRows)) {
    const l = t.links.find((x) => x.junctionTable === junction);
    for (const chunk of chunks(rows, CHUNK)) {
      const { error } = await supabase.from(junction).upsert(chunk, {
        onConflict: `${l.sourceColumn},${l.targetColumn}`, ignoreDuplicates: true,
      });
      if (error) fail(`junction insert into ${junction} failed: ${error.message}`);
    }
    console.log(`  ${junction}: ${rows.length} link rows`);
  }
  if (fkUpdates.length) console.log(`  ${t.pgName}: ${fkUpdates.length} rows linked`);
}

// ---------------------------------------------------------------------------
// Pass 3 — table merges from schema-overrides.json (e.g. fold a leftover
// Airtable table into its real counterpart, deduplicating along the way)
// ---------------------------------------------------------------------------
const overridesPath = join(ROOT, 'tools/schema-overrides.json');
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};

for (const merge of overrides.mergeTables ?? []) {
  const target = model.tables.find((t) => t.pgName === merge.into);
  if (!target) { console.warn(`! merge target ${merge.into} not in schema map, skipping`); continue; }
  console.log(`\n[merge] "${merge.from}" -> ${merge.into}`);

  const records = FROM_CSV
    ? readCsvRecords({ airtableName: merge.from })
    : await fetchAllRecords(AIRTABLE_API_KEY, AIRTABLE_BASE_ID, merge.from);
  const colType = Object.fromEntries(target.columns.map((c) => [c.pgName, c.pgType]));

  // existing values in the target table, per dedupe column (case-insensitive)
  const existing = Object.fromEntries((merge.dedupeBy ?? []).map((c) => [c, new Set()]));
  const dedupeCols = Object.keys(existing);
  if (dedupeCols.length) {
    for await (const row of selectAll(merge.into, ['id', ...dedupeCols].join(', '))) {
      for (const c of dedupeCols) if (row[c]) existing[c].add(String(row[c]).trim().toLowerCase());
    }
  }

  const rows = [];
  let duplicates = 0;
  for (const rec of records) {
    const row = { airtable_id: rec.id, source: 'airtable' };
    for (const [fromField, toCol] of Object.entries(merge.fieldMap)) {
      row[toCol] = coerceValue(rec.fields[fromField], colType[toCol] ?? 'text');
    }
    const isDup = dedupeCols.some((c) => row[c] && existing[c].has(String(row[c]).trim().toLowerCase()));
    if (isDup) { duplicates++; continue; }
    for (const c of dedupeCols) if (row[c]) existing[c].add(String(row[c]).trim().toLowerCase());
    rows.push(row);
  }

  for (const chunk of chunks(rows, CHUNK)) {
    const { error } = await supabase.from(merge.into).upsert(chunk, { onConflict: 'airtable_id' });
    if (error) fail(`merge into ${merge.into} failed: ${error.message}`);
  }
  stats.tables[`${merge.into} (merged from "${merge.from}")`] = { records: rows.length };
  console.log(`  ${records.length} records: ${rows.length} merged, ${duplicates} skipped as duplicates`);
}

// ---------------------------------------------------------------------------
console.log('\n===== migration summary =====');
for (const [table, s] of Object.entries(stats.tables)) console.log(`  ${table}: ${s.records} records`);
console.log(stats.unresolvedLinks
  ? `  ⚠ ${stats.unresolvedLinks} unresolved link(s) — see warnings above. Fix at the source and re-run (idempotent).`
  : '  all links resolved cleanly ✓');

// ---------------------------------------------------------------------------
async function fetchAirtableRecords(t) {
  return fetchAllRecords(AIRTABLE_API_KEY, AIRTABLE_BASE_ID, t.airtableId ?? t.airtableName,
    (n) => process.stdout.write(`\r  fetched ${n}…`)).then((r) => (console.log(), r));
}

// CSV rows -> the same {id, fields} shape the API returns. Uses an
// "airtable_id" column if present (add a RECORD_ID() formula field before
// exporting); otherwise derives a stable id from the row content so re-runs
// stay idempotent.
function readCsvRecords(t) {
  const path = join(ROOT, 'data/csv', `${t.airtableName}.csv`);
  const raw = parse(readFileSync(path), { columns: true, skip_empty_lines: true });
  return raw.map((row) => {
    const idKey = Object.keys(row).find((k) => /^(airtable_id|record[ _]?id)$/i.test(k.trim()));
    const id = idKey && row[idKey]
      ? row[idKey]
      : 'csv_' + createHash('sha1').update(t.airtableName + JSON.stringify(row)).digest('hex').slice(0, 17);
    return { id, fields: row };
  });
}

async function* selectAll(table, columns) {
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) fail(`select from ${table} failed: ${error.message}`);
    yield* data;
    if (data.length < PAGE) return;
  }
}

function* chunks(arr, size) {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

function quote(name) {
  return `"${name}"`;
}

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}
