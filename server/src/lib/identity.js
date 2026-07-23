// Same-person detection across different emails.
// Rules live in server/src/config/identity-match.json — tune phone/name there.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { supabase } from './supabase.js';

const configPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../config/identity-match.json',
);

let cachedConfig;
function config() {
  if (!cachedConfig) {
    cachedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  }
  return cachedConfig;
}

/** Digits-only phone; compare last N digits (default 10) for US-style numbers. */
export function normalizePhone(raw, rules = config().rules.phone) {
  if (raw == null || raw === '') return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < (rules.minDigits ?? 7)) return null;
  const n = rules.compareLastN ?? 10;
  return digits.length > n ? digits.slice(-n) : digits;
}

/** Lowercase, collapse whitespace, strip punctuation for name compare. */
export function normalizeName(raw, rules = config().rules.name) {
  if (raw == null || raw === '') return null;
  let s = String(raw).toLowerCase().trim();
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < (rules.minLength ?? 4)) return null;
  const ignored = new Set((config().ignoreNameValues || []).map((x) => x.toLowerCase()));
  if (ignored.has(s)) return null;
  // Skip very long "names" that are clearly Typeform answer bleed
  if (s.length > 60) return null;
  return s;
}

function pairIds(a, b) {
  return a < b ? [a, b] : [b, a];
}

/**
 * After a lead is written, find other leads that share phone and/or name
 * (different email) and upsert identity_matches rows + possible_duplicate flags.
 */
export async function flagIdentityMatches(leadId) {
  const cfg = config();
  if (!cfg.enabled || !leadId) return [];

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, email, lead_name, phone')
    .eq('id', leadId)
    .maybeSingle();
  if (error || !lead) {
    if (error) console.warn('flagIdentityMatches load:', error.message);
    return [];
  }

  const phoneKey = cfg.rules.phone?.enabled ? normalizePhone(lead.phone) : null;
  const nameKey = cfg.rules.name?.enabled ? normalizeName(lead.lead_name) : null;
  if (!phoneKey && !nameKey) return [];

  // Pull a bounded candidate set — filter in JS after normalize.
  // Phone: fetch rows with any phone; Name: ilike exact-ish.
  let candidates = [];

  if (phoneKey) {
    const { data, error: pErr } = await supabase
      .from('leads')
      .select('id, email, lead_name, phone')
      .neq('id', leadId)
      .not('phone', 'is', null)
      .limit(2000);
    if (pErr) console.warn('flagIdentityMatches phone scan:', pErr.message);
    else candidates.push(...(data || []));
  }

  if (nameKey) {
    // Broad fetch by first token to keep the query cheap
    const token = nameKey.split(' ')[0];
    if (token.length >= 3) {
      const { data, error: nErr } = await supabase
        .from('leads')
        .select('id, email, lead_name, phone')
        .neq('id', leadId)
        .ilike('lead_name', `%${token}%`)
        .limit(500);
      if (nErr) console.warn('flagIdentityMatches name scan:', nErr.message);
      else candidates.push(...(data || []));
    }
  }

  // Dedupe candidates by id
  const byId = new Map();
  for (const c of candidates) byId.set(c.id, c);

  const created = [];
  const touched = new Set([leadId]);

  for (const other of byId.values()) {
    // Skip same email (already the same lead identity by our primary key)
    if ((other.email || '').toLowerCase() === (lead.email || '').toLowerCase()) continue;

    const otherPhone = normalizePhone(other.phone);
    const otherName = normalizeName(other.lead_name);

    const matchOn = [];
    if (phoneKey && otherPhone && phoneKey === otherPhone) matchOn.push('phone');
    if (nameKey && otherName && nameKey === otherName) matchOn.push('name');
    if (!matchOn.length) continue;

    let confidence = matchOn.includes('phone')
      ? (cfg.rules.phone.confidence || 'high')
      : (cfg.rules.name.confidence || 'medium');

    if (
      matchOn.includes('phone')
      && matchOn.includes('name')
      && cfg.rules.phone_and_name?.enabled
    ) {
      confidence = cfg.rules.phone_and_name.confidence || 'high';
    }

    // Name-only matches stay medium unless phone also hits
    if (matchOn.length === 1 && matchOn[0] === 'name') {
      confidence = cfg.rules.name.confidence || 'medium';
    }

    const [a, b] = pairIds(lead.id, other.id);
    const details = {
      emails: [lead.email, other.email],
      names: [lead.lead_name, other.lead_name],
      phones: [lead.phone, other.phone],
      phone_key: phoneKey && matchOn.includes('phone') ? phoneKey : null,
      name_key: nameKey && matchOn.includes('name') ? nameKey : null,
    };

    const { data: existing, error: findErr } = await supabase
      .from('identity_matches')
      .select('id, status')
      .eq('lead_a_id', a)
      .eq('lead_b_id', b)
      .maybeSingle();

    if (findErr) {
      if (/identity_matches|does not exist|schema cache/i.test(findErr.message)) {
        console.warn('identity_matches missing — apply supabase/migrations/0006_identity_matches.sql');
        return [];
      }
      console.warn('flagIdentityMatches lookup:', findErr.message);
      continue;
    }

    if (existing) {
      // Never reopen a dismissed pair; refresh evidence only.
      const patch = { match_on: matchOn, confidence, details };
      if (existing.status !== 'dismissed' && existing.status !== 'confirmed') {
        patch.status = 'open';
      }
      await supabase.from('identity_matches').update(patch).eq('id', existing.id);
      touched.add(other.id);
      created.push({ id: existing.id, matchOn, confidence, otherId: other.id, status: existing.status });
      continue;
    }

    const { data: row, error: insErr } = await supabase
      .from('identity_matches')
      .insert({
        lead_a_id: a,
        lead_b_id: b,
        match_on: matchOn,
        confidence,
        details,
        status: 'open',
      })
      .select('id, status')
      .single();

    if (insErr) {
      console.warn('flagIdentityMatches insert:', insErr.message);
      continue;
    }
    touched.add(other.id);
    created.push({ id: row?.id, matchOn, confidence, otherId: other.id, status: row?.status });
  }

  await refreshDuplicateFlags([...touched]);
  return created;
}

async function refreshDuplicateFlags(leadIds) {
  const ids = [...new Set(leadIds.filter(Boolean))];
  if (!ids.length) return;

  // Prefer the SQL helper; fall back to per-lead updates.
  const { error: rpcErr } = await supabase.rpc('refresh_lead_duplicate_flags', {
    p_lead_ids: ids,
  });
  if (!rpcErr) return;

  for (const id of ids) {
    const { count } = await supabase
      .from('identity_matches')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .or(`lead_a_id.eq.${id},lead_b_id.eq.${id}`);
    await supabase.from('leads').update({
      possible_duplicate: (count ?? 0) > 0,
    }).eq('id', id);
  }
}

/** Re-scan every lead (backfill). */
export async function scanAllIdentityMatches({ limit = 5000 } = {}) {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  let pairs = 0;
  for (const lead of leads || []) {
    const found = await flagIdentityMatches(lead.id);
    pairs += found.length;
  }
  return { scanned: (leads || []).length, pairsWritten: pairs };
}
