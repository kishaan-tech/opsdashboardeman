// Resolve a tenant org for inbound webhooks and load credentials from env.
//
// Per-org secrets live in Vercel / .env (not the DB). Naming:
//   ORG_<SLUG>_WEBHOOK_SECRET
//   ORG_<SLUG>_CALENDLY_PAT
//   ORG_<SLUG>_TYPEFORM_API_KEY
//   ORG_<SLUG>_TYPEFORM_FORM_IDS
//   ORG_<SLUG>_ICLOSED_API_KEY
//   ORG_<SLUG>_FANBASIS_API_KEY
// where <SLUG> is the org slug uppercased with hyphens → underscores
// (e.g. slug "emanfba" → ORG_EMANFBA_WEBHOOK_SECRET).
//
// The seeded "dooly" org also falls back to the legacy global keys:
// WEBHOOK_SECRET, CALENDLY_API_KEY, TYPEFORM_API_KEY, TYPEFORM_FORM_IDS.

import { supabase } from './supabase.js';
import { asProviderList } from './providers.js';

/** @param {string} slug */
export function orgEnvPrefix(slug) {
  return `ORG_${String(slug).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/** @param {string} slug */
export function orgEnvVarNames(slug) {
  const p = orgEnvPrefix(slug);
  return {
    webhook_secret: `${p}_WEBHOOK_SECRET`,
    calendly_pat: `${p}_CALENDLY_PAT`,
    typeform_api_key: `${p}_TYPEFORM_API_KEY`,
    typeform_form_ids: `${p}_TYPEFORM_FORM_IDS`,
    iclosed_api_key: `${p}_ICLOSED_API_KEY`,
    fanbasis_api_key: `${p}_FANBASIS_API_KEY`,
  };
}

function env(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : null;
}

/**
 * Load secrets for an org slug from process.env (never returns secret values
 * to the browser — callers decide what to expose).
 * @param {string} slug
 */
export function loadOrgSecretsFromEnv(slug) {
  const names = orgEnvVarNames(slug);
  let webhookSecret = env(names.webhook_secret);
  let calendlyPat = env(names.calendly_pat);
  let typeformApiKey = env(names.typeform_api_key);
  let typeformFormIds = env(names.typeform_form_ids);
  let iclosedApiKey = env(names.iclosed_api_key);
  let fanbasisApiKey = env(names.fanbasis_api_key);

  // Legacy globals for the default / dooly org
  const isDefault = slug === (process.env.DEFAULT_ORG_SLUG || 'dooly');
  if (isDefault) {
    webhookSecret = webhookSecret || env('WEBHOOK_SECRET');
    calendlyPat = calendlyPat || env('CALENDLY_API_KEY');
    typeformApiKey = typeformApiKey || env('TYPEFORM_API_KEY');
    typeformFormIds = typeformFormIds || env('TYPEFORM_FORM_IDS');
  }

  const configured = Boolean(webhookSecret);
  return {
    env_vars: names,
    webhook_secret: webhookSecret,
    calendly_pat: calendlyPat,
    typeform_api_key: typeformApiKey,
    typeform_form_ids: typeformFormIds,
    iclosed_api_key: iclosedApiKey,
    fanbasis_api_key: fanbasisApiKey,
    has_webhook_secret: Boolean(webhookSecret),
    has_calendly_pat: Boolean(calendlyPat),
    has_typeform_api_key: Boolean(typeformApiKey),
    has_typeform_form_ids: Boolean(typeformFormIds),
    has_iclosed_api_key: Boolean(iclosedApiKey),
    has_fanbasis_api_key: Boolean(fanbasisApiKey),
    status: configured ? 'configured' : 'incomplete',
  };
}

/** Public status for admin UI — no secret values. */
export function orgIntegrationsStatus(slug, row, orgProviders = {}) {
  const secrets = loadOrgSecretsFromEnv(slug);
  const forms = asProviderList(orgProviders.forms_providers ?? orgProviders.forms_provider, 'typeform');
  const bookings = asProviderList(orgProviders.bookings_providers ?? orgProviders.bookings_provider, 'calendly');
  const payments = asProviderList(orgProviders.payments_providers ?? orgProviders.payments_provider, 'whop');
  return {
    org_id: row?.org_id ?? null,
    status: secrets.status,
    last_webhook_at: row?.last_webhook_at ?? null,
    has_webhook_secret: secrets.has_webhook_secret,
    has_calendly_pat: secrets.has_calendly_pat,
    has_typeform_api_key: secrets.has_typeform_api_key,
    has_typeform_form_ids: secrets.has_typeform_form_ids,
    has_iclosed_api_key: secrets.has_iclosed_api_key,
    has_fanbasis_api_key: secrets.has_fanbasis_api_key,
    typeform_form_ids: secrets.typeform_form_ids || null,
    env_vars: secrets.env_vars,
    providers: { forms, bookings, payments },
    updated_at: row?.updated_at ?? null,
  };
}

/** Webhook URL templates for the org's selected providers (multi). */
export function orgWebhookUrlTemplates(slug, providers = {}) {
  const forms = asProviderList(providers.forms_providers ?? providers.forms_provider, 'typeform');
  const bookings = asProviderList(providers.bookings_providers ?? providers.bookings_provider, 'calendly');
  const payments = asProviderList(providers.payments_providers ?? providers.payments_provider, 'whop');
  const urls = [];
  if (forms.includes('iclosed') || bookings.includes('iclosed')) {
    urls.push({
      channel: 'iclosed',
      provider: 'iclosed',
      path: `/api/webhooks/${slug}/iclosed?secret=…`,
      note: 'Single URL for iClosed contact + call webhooks',
    });
  }
  if (forms.includes('typeform')) {
    urls.push({
      channel: 'forms',
      provider: 'typeform',
      path: `/api/webhooks/${slug}/forms?source=typeform&secret=…`,
    });
  }
  if (bookings.includes('calendly')) {
    urls.push({
      channel: 'bookings',
      provider: 'calendly',
      path: `/api/webhooks/${slug}/bookings?source=calendly&secret=…`,
    });
  }
  if (payments.includes('whop')) {
    urls.push({
      channel: 'payments',
      provider: 'whop',
      path: `/api/webhooks/${slug}/payments?source=whop&secret=…`,
    });
  }
  if (payments.includes('fanbasis')) {
    urls.push({
      channel: 'payments',
      provider: 'fanbasis',
      path: `/api/webhooks/${slug}/payments?source=fanbasis&secret=…`,
      note: 'Point Fanbasis webhook subscription here (payment.succeeded, etc.)',
    });
  }
  return urls;
}

/**
 * @param {import('express').Request} req
 * @returns {Promise<{ org: object, integrations: object, webhookSecret: string | null } | null>}
 */
export async function resolveOrgFromRequest(req) {
  const slug =
    req.params.orgSlug ||
    req.query.org ||
    req.query.org_slug ||
    process.env.DEFAULT_ORG_SLUG ||
    'dooly';

  if (!slug || typeof slug !== 'string') return null;

  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, slug, name, status, forms_providers, bookings_providers, payments_providers')
    .eq('slug', slug.trim().toLowerCase())
    .maybeSingle();

  if (error) throw new Error(`org lookup failed: ${error.message}`);
  if (!org || org.status !== 'active') return null;

  const { data: integrations } = await supabase
    .from('org_integrations')
    .select('org_id, status, last_webhook_at, updated_at')
    .eq('org_id', org.id)
    .maybeSingle();

  const secrets = loadOrgSecretsFromEnv(org.slug);

  return {
    org,
    integrations: integrations ?? null,
    webhookSecret: secrets.webhook_secret,
  };
}

export async function touchOrgWebhook(orgId) {
  if (!orgId) return;
  await supabase
    .from('org_integrations')
    .upsert(
      {
        org_id: orgId,
        last_webhook_at: new Date().toISOString(),
        status: 'configured',
      },
      { onConflict: 'org_id' },
    );
}

export async function writeAuditLog({ actorId, orgId, action, details }) {
  const { error } = await supabase.from('admin_audit_log').insert({
    actor_id: actorId ?? null,
    org_id: orgId ?? null,
    action,
    details: details ?? {},
  });
  if (error) console.warn('audit log write failed:', error.message);
}
