// Minimal Airtable REST client (no SDK dependency).
// Airtable rate limit is 5 req/s per base; we stay well under it.

const BASE_URL = 'https://api.airtable.com/v0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function airtableGet(apiKey, path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status === 429) { await sleep(1500); continue; } // rate limited: back off and retry
    if (!res.ok) throw new Error(`Airtable ${res.status} on ${path}: ${await res.text()}`);
    return res.json();
  }
  throw new Error(`Airtable rate limit persisted on ${path}`);
}

/** Base schema: tables, fields, types. Needs schema.bases:read scope. */
export async function fetchBaseSchema(apiKey, baseId) {
  const { tables } = await airtableGet(apiKey, `/meta/bases/${baseId}/tables`);
  return tables;
}

/** All records of a table, transparently following pagination. */
export async function fetchAllRecords(apiKey, baseId, tableId, onPage = () => {}) {
  const records = [];
  let offset;
  do {
    const page = await airtableGet(apiKey, `/${baseId}/${encodeURIComponent(tableId)}`, {
      pageSize: 100,
      offset,
    });
    records.push(...page.records);
    onPage(records.length);
    offset = page.offset;
    if (offset) await sleep(250);
  } while (offset);
  return records;
}
