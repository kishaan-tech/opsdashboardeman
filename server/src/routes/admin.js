import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import {
  writeAuditLog,
  orgIntegrationsStatus,
  orgEnvVarNames,
  loadOrgSecretsFromEnv,
  orgWebhookUrlTemplates,
} from '../lib/org.js';
import {
  FORMS_PROVIDERS,
  BOOKINGS_PROVIDERS,
  PAYMENTS_PROVIDERS,
  asProviderList,
} from '../lib/providers.js';
import { importVendorCsv } from '../lib/csvImport.js';

export const adminRouter = Router();

function generateTempPassword() {
  // Readable temp password for first login (admin copies once from UI).
  return `oh-${randomBytes(9).toString('base64url')}`;
}

async function findAuthUserByEmail(email) {
  const target = email.toLowerCase();
  // Admin listUsers has no email filter; paginate a few pages (internal tool scale).
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

async function ensureAuthUser({ email, password }) {
  const existing = await findAuthUserByEmail(email);
  if (existing) return { user: existing, created: false, tempPassword: null };

  const tempPassword = password || generateTempPassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (error) {
    // Race: another create won; re-lookup.
    if (/already|registered|exists/i.test(error.message)) {
      const again = await findAuthUserByEmail(email);
      if (again) return { user: again, created: false, tempPassword: null };
    }
    throw error;
  }
  return {
    user: data.user,
    created: true,
    // Only return generated password when admin did not supply one.
    tempPassword: password ? null : tempPassword,
  };
}

async function emailsForUserIds(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const map = {};
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    for (const u of data?.users || []) {
      if (ids.includes(u.id)) map[u.id] = u.email || null;
    }
    if (Object.keys(map).length >= ids.length) break;
    if ((data?.users || []).length < 200) break;
  }
  return map;
}

function parseProviderList(raw, allowed, field) {
  if (raw == null) return { value: null };
  const list = asProviderList(raw);
  if (!list.length) return { error: `${field} requires at least one provider` };
  const bad = list.filter((v) => !allowed.includes(v));
  if (bad.length) {
    return { error: `${field} invalid: ${bad.join(', ')} (allowed: ${allowed.join('|')})` };
  }
  return { value: list };
}

function parseProviders(body = {}) {
  const patch = {};
  const forms = parseProviderList(
    body.forms_providers ?? body.forms_provider,
    FORMS_PROVIDERS,
    'forms_providers',
  );
  if (forms.error) return { error: forms.error };
  if (forms.value) patch.forms_providers = forms.value;

  const bookings = parseProviderList(
    body.bookings_providers ?? body.bookings_provider,
    BOOKINGS_PROVIDERS,
    'bookings_providers',
  );
  if (bookings.error) return { error: bookings.error };
  if (bookings.value) patch.bookings_providers = bookings.value;

  const payments = parseProviderList(
    body.payments_providers ?? body.payments_provider,
    PAYMENTS_PROVIDERS,
    'payments_providers',
  );
  if (payments.error) return { error: payments.error };
  if (payments.value) patch.payments_providers = payments.value;

  return { patch };
}

function anonClient(jwt) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Require a valid Supabase JWT and attach user + platformAdmin flag. */
export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'missing bearer token' });

  const client = anonClient(token);
  if (!client) return res.status(503).json({ ok: false, error: 'auth not configured' });

  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return res.status(401).json({ ok: false, error: 'invalid token' });

  const { data: adminRow } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  req.user = user;
  req.isPlatformAdmin = Boolean(adminRow);
  req.accessToken = token;
  next();
}

export function requirePlatformAdmin(req, res, next) {
  if (!req.isPlatformAdmin) {
    return res.status(403).json({ ok: false, error: 'platform admin required' });
  }
  next();
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || `org-${randomBytes(3).toString('hex')}`;
}

adminRouter.get('/me', async (req, res) => {
  const { data: memberships, error } = await supabase
    .from('org_memberships')
    .select('id, org_id, role, sales_rep_id, organizations(id, slug, name, status)')
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ ok: false, error: error.message });

  let allOrgs = null;
  if (req.isPlatformAdmin) {
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, slug, name, status')
      .order('name');
    allOrgs = orgs || [];
  }

  res.json({
    ok: true,
    user: { id: req.user.id, email: req.user.email },
    is_platform_admin: req.isPlatformAdmin,
    memberships: (memberships || []).map((m) => ({
      id: m.id,
      org_id: m.org_id,
      role: m.role,
      sales_rep_id: m.sales_rep_id,
      org: m.organizations,
    })),
    orgs: allOrgs,
  });
});

adminRouter.get('/orgs', requirePlatformAdmin, async (_req, res) => {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug, name, status, forms_providers, bookings_providers, payments_providers, created_at, updated_at')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const orgIds = (data || []).map((o) => o.id);
  const { data: ints } = await supabase
    .from('org_integrations')
    .select('org_id, status, last_webhook_at, updated_at')
    .in('org_id', orgIds.length ? orgIds : ['00000000-0000-0000-0000-000000000000']);

  const byOrg = Object.fromEntries((ints || []).map((i) => [i.org_id, i]));
  const { data: memberCounts } = await supabase
    .from('org_memberships')
    .select('org_id');

  const countMap = {};
  for (const m of memberCounts || []) {
    countMap[m.org_id] = (countMap[m.org_id] || 0) + 1;
  }

  res.json({
    ok: true,
    orgs: (data || []).map((o) => ({
      ...o,
      member_count: countMap[o.id] || 0,
      integrations: orgIntegrationsStatus(o.slug, byOrg[o.id] || { org_id: o.id }, o),
    })),
  });
});

adminRouter.post('/orgs', requirePlatformAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  let slug = String(req.body?.slug || slugify(name)).toLowerCase().trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return res.status(400).json({ ok: false, error: 'invalid slug' });
  }

  const { patch: providerPatch, error: providerErr } = parseProviders(req.body);
  if (providerErr) return res.status(400).json({ ok: false, error: providerErr });

  const insert = {
    name,
    slug,
    status: 'active',
    forms_providers: providerPatch.forms_providers || ['typeform'],
    bookings_providers: providerPatch.bookings_providers || ['calendly'],
    payments_providers: providerPatch.payments_providers || ['whop'],
  };

  const { data: org, error } = await supabase
    .from('organizations')
    .insert(insert)
    .select('id, slug, name, status, forms_providers, bookings_providers, payments_providers, created_at')
    .single();
  if (error) return res.status(400).json({ ok: false, error: error.message });

  const secrets = loadOrgSecretsFromEnv(org.slug);
  await supabase.from('org_integrations').upsert({
    org_id: org.id,
    status: secrets.status,
  });

  await writeAuditLog({
    actorId: req.user.id,
    orgId: org.id,
    action: 'org.create',
    details: { slug: org.slug, name: org.name, providers: providerPatch },
  });

  res.status(201).json({
    ok: true,
    org,
    env_vars: orgEnvVarNames(org.slug),
    webhook_urls: orgWebhookUrlTemplates(org.slug, org),
    integrations: orgIntegrationsStatus(org.slug, { org_id: org.id }, org),
  });
});

adminRouter.get('/orgs/:orgId', requirePlatformAdmin, async (req, res) => {
  const { data: org, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', req.params.orgId)
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!org) return res.status(404).json({ ok: false, error: 'not found' });

  const { data: members } = await supabase
    .from('org_memberships')
    .select('id, user_id, role, sales_rep_id, created_at')
    .eq('org_id', org.id);

  const emailByUserId = await emailsForUserIds((members || []).map((m) => m.user_id));
  const membersWithEmail = (members || []).map((m) => ({
    ...m,
    email: emailByUserId[m.user_id] || null,
  }));

  const { data: integrations } = await supabase
    .from('org_integrations')
    .select('org_id, status, last_webhook_at, updated_at')
    .eq('org_id', org.id)
    .maybeSingle();

  const { data: recentEvents } = await supabase
    .from('ingestion_events')
    .select('id, source, event_type, status, received_at, error')
    .eq('org_id', org.id)
    .order('received_at', { ascending: false })
    .limit(20);

  const { count: eventFailCount } = await supabase
    .from('ingestion_events')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.id)
    .eq('status', 'failed');

  const status = orgIntegrationsStatus(org.slug, integrations || { org_id: org.id }, org);

  // Keep DB status row in sync with env presence (no secrets stored)
  await supabase.from('org_integrations').upsert({
    org_id: org.id,
    status: status.status,
    last_webhook_at: integrations?.last_webhook_at ?? null,
  });

  res.json({
    ok: true,
    org,
    members: membersWithEmail,
    integrations: status,
    webhook_urls: orgWebhookUrlTemplates(org.slug, org),
    provider_options: {
      forms: FORMS_PROVIDERS,
      bookings: BOOKINGS_PROVIDERS,
      payments: PAYMENTS_PROVIDERS,
    },
    webhook_health: {
      last_webhook_at: integrations?.last_webhook_at ?? null,
      recent_events: recentEvents || [],
      failed_count: eventFailCount ?? 0,
    },
  });
});

adminRouter.patch('/orgs/:orgId', requirePlatformAdmin, async (req, res) => {
  const patch = {};
  if (req.body?.name) patch.name = String(req.body.name).trim();
  if (req.body?.status && ['active', 'paused', 'archived'].includes(req.body.status)) {
    patch.status = req.body.status;
  }
  const { patch: providerPatch, error: providerErr } = parseProviders(req.body);
  if (providerErr) return res.status(400).json({ ok: false, error: providerErr });
  Object.assign(patch, providerPatch);

  if (!Object.keys(patch).length) {
    return res.status(400).json({ ok: false, error: 'nothing to update' });
  }
  const { data, error } = await supabase
    .from('organizations')
    .update(patch)
    .eq('id', req.params.orgId)
    .select('*')
    .single();
  if (error) return res.status(400).json({ ok: false, error: error.message });

  await writeAuditLog({
    actorId: req.user.id,
    orgId: data.id,
    action: 'org.update',
    details: patch,
  });
  res.json({
    ok: true,
    org: data,
    webhook_urls: orgWebhookUrlTemplates(data.slug, data),
  });
});

/** Refresh env-based integration status (secrets are set in Vercel/.env, not here). */
adminRouter.get('/orgs/:orgId/integrations', requirePlatformAdmin, async (req, res) => {
  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, slug, forms_providers, bookings_providers, payments_providers')
    .eq('id', req.params.orgId)
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!org) return res.status(404).json({ ok: false, error: 'not found' });

  const { data: row } = await supabase
    .from('org_integrations')
    .select('org_id, status, last_webhook_at, updated_at')
    .eq('org_id', org.id)
    .maybeSingle();

  const status = orgIntegrationsStatus(org.slug, row || { org_id: org.id }, org);
  await supabase.from('org_integrations').upsert({
    org_id: org.id,
    status: status.status,
    last_webhook_at: row?.last_webhook_at ?? null,
  });

  res.json({
    ok: true,
    integrations: status,
    webhook_urls: orgWebhookUrlTemplates(org.slug, org),
  });
});

adminRouter.post('/orgs/:orgId/members', requirePlatformAdmin, async (req, res) => {
  const orgId = req.params.orgId;
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = String(req.body?.role || 'viewer');
  const passwordRaw = req.body?.password;
  const password = passwordRaw != null && String(passwordRaw).trim()
    ? String(passwordRaw)
    : null;
  if (!email) return res.status(400).json({ ok: false, error: 'email required' });
  if (!['org_admin', 'manager', 'rep', 'viewer'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'invalid role' });
  }
  if (password && password.length < 8) {
    return res.status(400).json({ ok: false, error: 'password must be at least 8 characters' });
  }

  let ensured;
  try {
    ensured = await ensureAuthUser({ email, password });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: `Auth user create/lookup failed: ${err.message || err}`,
    });
  }
  const { user, created, tempPassword } = ensured;

  const row = {
    org_id: orgId,
    user_id: user.id,
    role,
    sales_rep_id: req.body?.sales_rep_id || null,
  };

  const { data, error } = await supabase
    .from('org_memberships')
    .upsert(row, { onConflict: 'org_id,user_id' })
    .select('*')
    .single();
  if (error) return res.status(400).json({ ok: false, error: error.message });

  await writeAuditLog({
    actorId: req.user.id,
    orgId,
    action: 'org.member.upsert',
    details: { email, role, user_id: user.id, auth_created: created },
  });

  res.status(201).json({
    ok: true,
    member: { ...data, email },
    auth_created: created,
    // Shown once in admin UI when we auto-generated a password.
    temporary_password: tempPassword,
  });
});

adminRouter.patch('/orgs/:orgId/members/:memberId', requirePlatformAdmin, async (req, res) => {
  const patch = {};
  if (req.body?.role && ['org_admin', 'manager', 'rep', 'viewer'].includes(req.body.role)) {
    patch.role = req.body.role;
  }
  if (req.body?.sales_rep_id !== undefined) {
    patch.sales_rep_id = req.body.sales_rep_id || null;
  }
  const { data, error } = await supabase
    .from('org_memberships')
    .update(patch)
    .eq('id', req.params.memberId)
    .eq('org_id', req.params.orgId)
    .select('*')
    .single();
  if (error) return res.status(400).json({ ok: false, error: error.message });

  await writeAuditLog({
    actorId: req.user.id,
    orgId: req.params.orgId,
    action: 'org.member.update',
    details: { member_id: req.params.memberId, ...patch },
  });
  res.json({ ok: true, member: data });
});

adminRouter.delete('/orgs/:orgId/members/:memberId', requirePlatformAdmin, async (req, res) => {
  const { error } = await supabase
    .from('org_memberships')
    .delete()
    .eq('id', req.params.memberId)
    .eq('org_id', req.params.orgId);
  if (error) return res.status(400).json({ ok: false, error: error.message });

  await writeAuditLog({
    actorId: req.user.id,
    orgId: req.params.orgId,
    action: 'org.member.remove',
    details: { member_id: req.params.memberId },
  });
  res.json({ ok: true });
});

adminRouter.get('/orgs/:orgId/audit', requirePlatformAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('*')
    .eq('org_id', req.params.orgId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, events: data || [] });
});

/** Import Typeform / Calendly / Whop CSV exports into this org (same path as webhooks). */
adminRouter.post('/orgs/:orgId/import-csv', requirePlatformAdmin, async (req, res) => {
  const orgId = req.params.orgId;
  const vendor = String(req.body?.vendor || '').trim().toLowerCase();
  const csvText = req.body?.csv;
  const formName = req.body?.form_name ? String(req.body.form_name).trim() : undefined;

  if (!['typeform', 'calendly', 'whop'].includes(vendor)) {
    return res.status(400).json({
      ok: false,
      error: 'vendor must be typeform, calendly, or whop',
    });
  }
  if (!csvText || typeof csvText !== 'string') {
    return res.status(400).json({ ok: false, error: 'csv string required' });
  }
  if (csvText.length > 14_000_000) {
    return res.status(413).json({ ok: false, error: 'CSV too large (max ~14MB)' });
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('id, slug')
    .eq('id', orgId)
    .maybeSingle();
  if (!org) return res.status(404).json({ ok: false, error: 'org not found' });

  try {
    const summary = await importVendorCsv({
      orgId,
      vendor,
      csvText,
      formName,
      actorId: req.user.id,
    });
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message ?? err) });
  }
});
