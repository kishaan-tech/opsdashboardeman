import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { ProviderIcon, PROVIDER_LABELS } from '../components/ProviderIcon.jsx';

import { ROLE_LABELS } from '../lib/permissions.js';

const ROLES = ['org_admin', 'manager', 'rep', 'viewer'];

function asList(v, fallback) {
  if (Array.isArray(v) && v.length) return v;
  if (typeof v === 'string' && v) return [v];
  return fallback ? [fallback] : [];
}

export default function AdminOrgDetailPage({ orgId }) {
  const [data, setData] = useState(null);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('manager');
  const [invitePassword, setInvitePassword] = useState('');
  const [createdCreds, setCreatedCreds] = useState(null);
  const [importBusy, setImportBusy] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [typeformFormName, setTypeformFormName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, auditRes] = await Promise.all([
        adminApi.getOrg(orgId),
        adminApi.audit(orgId).catch(() => ({ events: [] })),
      ]);
      setData(detail);
      setAudit(auditRes.events || []);
    } catch (err) {
      setError(String(err.message ?? err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function invite(e) {
    e.preventDefault();
    try {
      const res = await adminApi.inviteMember(orgId, {
        email: inviteEmail,
        role: inviteRole,
        password: invitePassword.trim() || undefined,
      });
      const email = inviteEmail;
      setInviteEmail('');
      setInvitePassword('');
      if (res.auth_created && res.temporary_password) {
        setCreatedCreds({ email, password: res.temporary_password });
        setFlash(`Created Auth user + added ${email} as ${inviteRole}. Copy the password below — it won’t be shown again.`);
      } else if (res.auth_created) {
        setCreatedCreds(null);
        setFlash(`Created Auth user + added ${email} as ${inviteRole}.`);
      } else {
        setCreatedCreds(null);
        setFlash(`Added existing Auth user ${email} as ${inviteRole}.`);
      }
      await load();
    } catch (err) {
      setError(String(err.message ?? err));
    }
  }

  async function changeRole(memberId, role) {
    try {
      await adminApi.updateMember(orgId, memberId, { role });
      await load();
    } catch (err) {
      setError(String(err.message ?? err));
    }
  }

  async function removeMember(memberId) {
    if (!window.confirm('Remove this member?')) return;
    try {
      await adminApi.removeMember(orgId, memberId);
      await load();
    } catch (err) {
      setError(String(err.message ?? err));
    }
  }

  async function importCsv(vendor, file) {
    if (!file) return;
    setImportBusy(vendor);
    setError(null);
    setImportResult(null);
    try {
      const csv = await file.text();
      const res = await adminApi.importCsv(orgId, {
        vendor,
        csv,
        form_name: vendor === 'typeform' ? (typeformFormName.trim() || undefined) : undefined,
      });
      setImportResult(res.summary);
      setFlash(
        `Imported ${res.summary.imported}/${res.summary.rows_total} ${vendor} rows`
        + (res.summary.failed ? ` (${res.summary.failed} failed)` : '')
        + (res.summary.skipped ? ` (${res.summary.skipped} skipped)` : ''),
      );
      await load();
    } catch (err) {
      setError(String(err.message ?? err));
    } finally {
      setImportBusy(null);
    }
  }

  async function saveProviders(patch) {
    try {
      const res = await adminApi.updateOrg(orgId, patch);
      setFlash('Providers updated');
      setData((prev) => ({
        ...prev,
        org: res.org,
        webhook_urls: res.webhook_urls,
        integrations: {
          ...(prev?.integrations || {}),
          providers: {
            forms: res.org.forms_providers,
            bookings: res.org.bookings_providers,
            payments: res.org.payments_providers,
          },
        },
      }));
    } catch (err) {
      setError(String(err.message ?? err));
    }
  }

  if (loading && !data) {
    return <div className="p-6 text-mute">Loading…</div>;
  }

  const org = data?.org;
  const integrations = data?.integrations;
  const health = data?.webhook_health;
  const envVars = integrations?.env_vars || {};
  const options = data?.provider_options || {
    forms: ['typeform', 'iclosed'],
    bookings: ['calendly', 'iclosed'],
    payments: ['whop', 'fanbasis'],
  };
  const webhookUrls = data?.webhook_urls || [];
  const baseHint = typeof window !== 'undefined' ? window.location.origin : 'https://YOUR-APP.vercel.app';
  const formsProviders = asList(org?.forms_providers, 'typeform');
  const bookingsProviders = asList(org?.bookings_providers, 'calendly');
  const paymentsProviders = asList(org?.payments_providers, 'whop');

  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="border-b border-line-soft px-5 py-3">
        <a href="#/admin" className="text-xs text-mute hover:text-fg">‹ All orgs</a>
        <h2 className="mt-1 text-base font-semibold tracking-tight">{org?.name || 'Org'}</h2>
        <p className="mt-0.5 font-mono text-xs text-mute">{org?.slug} · {org?.status}</p>
      </header>

      <div className="space-y-5 p-5">
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>
        )}
        {flash && (
          <div className="rounded-lg border border-brand/30 bg-brand/10 p-3 text-sm text-fg">{flash}</div>
        )}

        <section className="rounded-lg border border-line-soft bg-panel p-4">
          <h3 className="text-sm font-semibold">Providers</h3>
          <p className="mt-1 text-xs text-mute">
            Multi-select — a client can run several tools on the same offer. Each selected payments processor can set closed / cash.
          </p>
          <div className="mt-4 grid gap-5 lg:grid-cols-3">
            <ProviderMultiSelect
              label="Forms (opt-in)"
              values={formsProviders}
              options={options.forms}
              onChange={(v) => saveProviders({ forms_providers: v })}
            />
            <ProviderMultiSelect
              label="Bookings"
              values={bookingsProviders}
              options={options.bookings}
              onChange={(v) => saveProviders({ bookings_providers: v })}
            />
            <ProviderMultiSelect
              label="Payments"
              values={paymentsProviders}
              options={options.payments}
              onChange={(v) => saveProviders({ payments_providers: v })}
            />
          </div>
        </section>

        <section className="rounded-lg border border-line-soft bg-panel p-4">
          <h3 className="text-sm font-semibold">Webhook URLs</h3>
          <p className="mt-1 text-xs text-mute">
            Paste into each selected vendor dashboard. Use this org&apos;s webhook secret in the query string.
          </p>
          <ul className="mt-3 space-y-2">
            {webhookUrls.map((u) => (
              <li
                key={`${u.provider}-${u.path}`}
                className="flex items-start gap-2 rounded-md border border-line-soft bg-panel-2 px-3 py-2"
              >
                <ProviderIcon id={u.provider || u.channel} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-fg">
                    {PROVIDER_LABELS[u.provider] || u.channel}
                  </p>
                  <p className="break-all font-mono text-[11px] text-soft">
                    {baseHint}{u.path}
                  </p>
                  {u.note && <p className="mt-0.5 text-[11px] text-mute">{u.note}</p>}
                </div>
              </li>
            ))}
            {webhookUrls.length === 0 && (
              <li className="text-sm text-mute">No URLs — select providers above.</li>
            )}
          </ul>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat label="Env status" value={integrations?.status || '—'} />
            <Stat
              label="Last webhook"
              value={health?.last_webhook_at
                ? new Date(health.last_webhook_at).toLocaleString()
                : 'Never'}
            />
            <Stat label="Failed events" value={String(health?.failed_count ?? 0)} />
          </div>
        </section>

        <section className="rounded-lg border border-line-soft bg-panel p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Secrets (Vercel / .env)</h3>
            <button
              type="button"
              onClick={load}
              className="rounded-md border border-line-soft px-3 py-1.5 text-xs text-mute hover:text-fg"
            >
              Refresh status
            </button>
          </div>
          <p className="mt-1 text-xs text-mute">
            Secrets are set manually in Vercel Project → Settings → Environment Variables
            (and local <code className="font-mono text-brand">.env</code>). Redeploy after changing Production env.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            <EnvRow
              name={envVars.webhook_secret}
              label="Webhook secret"
              ok={integrations?.has_webhook_secret}
              required
            />
            {bookingsProviders.includes('calendly') && (
              <EnvRow
                name={envVars.calendly_pat}
                label="Calendly PAT"
                ok={integrations?.has_calendly_pat}
                provider="calendly"
              />
            )}
            {formsProviders.includes('typeform') && (
              <>
                <EnvRow
                  name={envVars.typeform_api_key}
                  label="Typeform API key"
                  ok={integrations?.has_typeform_api_key}
                  provider="typeform"
                />
                <EnvRow
                  name={envVars.typeform_form_ids}
                  label="Typeform form IDs"
                  ok={integrations?.has_typeform_form_ids}
                  hint={integrations?.typeform_form_ids || null}
                  provider="typeform"
                />
              </>
            )}
            {(formsProviders.includes('iclosed') || bookingsProviders.includes('iclosed')) && (
              <EnvRow
                name={envVars.iclosed_api_key}
                label="iClosed API key"
                ok={integrations?.has_iclosed_api_key}
                provider="iclosed"
              />
            )}
            {paymentsProviders.includes('fanbasis') && (
              <EnvRow
                name={envVars.fanbasis_api_key}
                label="Fanbasis API key"
                ok={integrations?.has_fanbasis_api_key}
                provider="fanbasis"
              />
            )}
          </ul>
          {org?.slug === 'dooly' && (
            <p className="mt-3 text-[11px] text-mute">
              For <code className="font-mono">dooly</code>, legacy globals also work:
              {' '}<code className="font-mono">WEBHOOK_SECRET</code>,{' '}
              <code className="font-mono">CALENDLY_API_KEY</code>,{' '}
              <code className="font-mono">TYPEFORM_API_KEY</code>,{' '}
              <code className="font-mono">TYPEFORM_FORM_IDS</code>.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-line-soft bg-panel p-4">
          <h3 className="text-sm font-semibold">Team members</h3>
          <p className="mt-1 text-[11px] text-mute">
            Creates a Supabase Auth user if the email is new, then adds them to this org.
            Leave password blank to auto-generate one (shown once).
          </p>
          <form onSubmit={invite} className="mt-3 flex flex-wrap gap-2">
            <input
              type="email"
              className="min-w-[14rem] flex-1 rounded-md border border-line-soft bg-ink-2 px-3 py-2 text-sm"
              placeholder="user@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
            <input
              type="text"
              autoComplete="new-password"
              className="min-w-[10rem] flex-1 rounded-md border border-line-soft bg-ink-2 px-3 py-2 text-sm"
              placeholder="Password (optional)"
              value={invitePassword}
              onChange={(e) => setInvitePassword(e.target.value)}
            />
            <select
              className="rounded-md border border-line-soft bg-ink-2 px-3 py-2 text-sm"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
            </select>
            <button type="submit" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white">
              Add member
            </button>
          </form>
          {createdCreds && (
            <div className="mt-3 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-xs">
              <div className="font-medium text-ink">New login credentials (copy now)</div>
              <div className="mt-1 font-mono text-mute">Email: {createdCreds.email}</div>
              <div className="mt-0.5 break-all font-mono text-ink">{createdCreds.password}</div>
              <button
                type="button"
                className="mt-2 text-[11px] text-brand underline"
                onClick={() => {
                  navigator.clipboard?.writeText(
                    `Email: ${createdCreds.email}\nPassword: ${createdCreds.password}`,
                  );
                }}
              >
                Copy to clipboard
              </button>
            </div>
          )}
          <ul className="mt-4 divide-y divide-line-soft">
            {(data?.members || []).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate text-sm">
                  {m.email || <span className="font-mono text-xs text-mute">{m.user_id.slice(0, 8)}…</span>}
                </span>
                <select
                  className="rounded-md border border-line-soft bg-ink-2 px-2 py-1 text-xs"
                  value={m.role}
                  onChange={(e) => changeRole(m.id, e.target.value)}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                </select>
                <button
                  type="button"
                  className="text-xs text-danger hover:underline"
                  onClick={() => removeMember(m.id)}
                >
                  Remove
                </button>
              </li>
            ))}
            {(data?.members || []).length === 0 && (
              <li className="py-3 text-sm text-mute">No members yet</li>
            )}
          </ul>
        </section>

        <section className="rounded-lg border border-line-soft bg-panel p-4">
          <h3 className="text-sm font-semibold">Import CSV exports</h3>
          <p className="mt-1 text-[11px] text-mute">
            Upload native exports from Typeform (leads), Calendly (bookings), and Whop (payments).
            Rows go through the same ingest path as webhooks (idempotent).
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <CsvUploadCard
              title="Typeform → leads"
              hint="Results → Responses → Export CSV"
              busy={importBusy === 'typeform'}
              disabled={Boolean(importBusy)}
              onFile={(f) => importCsv('typeform', f)}
            >
              <input
                className="mb-2 w-full rounded-md border border-line-soft bg-ink-2 px-2 py-1.5 text-xs"
                placeholder="Form name (optional)"
                value={typeformFormName}
                onChange={(e) => setTypeformFormName(e.target.value)}
              />
            </CsvUploadCard>
            <CsvUploadCard
              title="Calendly → bookings"
              hint="Meetings / Scheduled events → Export"
              busy={importBusy === 'calendly'}
              disabled={Boolean(importBusy)}
              onFile={(f) => importCsv('calendly', f)}
            />
            <CsvUploadCard
              title="Whop → payments"
              hint="Payments export CSV (needs Payment Amount column)"
              busy={importBusy === 'whop'}
              disabled={Boolean(importBusy)}
              onFile={(f) => importCsv('whop', f)}
            />
          </div>
          {importResult && (
            <div className="mt-3 rounded-md border border-line-soft bg-ink-2 px-3 py-2 text-xs text-mute">
              <div>
                {importResult.vendor}: {importResult.imported} imported · {importResult.skipped} skipped · {importResult.failed} failed
                {' '}(of {importResult.rows_total})
              </div>
              {(importResult.errors || []).length > 0 && (
                <ul className="mt-1 max-h-24 overflow-auto font-mono text-[10px] text-danger">
                  {importResult.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>{e.reason}{e.external_id ? ` · ${e.external_id}` : ''}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-line-soft bg-panel p-4">
          <h3 className="text-sm font-semibold">Recent ingestion</h3>
          <ul className="mt-3 space-y-1 text-xs">
            {(health?.recent_events || []).map((ev) => (
              <li key={ev.id} className="flex justify-between gap-2 text-mute">
                <span>{ev.source} · {ev.event_type} · <span className={ev.status === 'failed' ? 'text-danger' : ''}>{ev.status}</span></span>
                <span>{new Date(ev.received_at).toLocaleString()}</span>
              </li>
            ))}
            {(health?.recent_events || []).length === 0 && (
              <li className="text-mute">No events yet</li>
            )}
          </ul>
        </section>

        <section className="rounded-lg border border-line-soft bg-panel p-4">
          <h3 className="text-sm font-semibold">Admin audit log</h3>
          <ul className="mt-3 space-y-1 text-xs text-mute">
            {audit.map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <span>{a.action}</span>
                <span>{new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))}
            {audit.length === 0 && <li>No audit events</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function CsvUploadCard({ title, hint, busy, disabled, onFile, children }) {
  return (
    <div className="rounded-md border border-line-soft bg-ink-2/40 p-3">
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-0.5 text-[10px] text-mute">{hint}</p>
      {children}
      <label className={`mt-2 inline-flex cursor-pointer items-center rounded-md border border-line-soft bg-panel px-3 py-1.5 text-xs ${disabled ? 'opacity-50' : 'hover:border-brand'}`}>
        {busy ? 'Importing…' : 'Choose CSV'}
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onFile(f);
          }}
        />
      </label>
    </div>
  );
}

function ProviderMultiSelect({ label, values, options, onChange }) {
  function toggle(id) {
    const set = new Set(values);
    if (set.has(id)) {
      if (set.size <= 1) return; // keep at least one
      set.delete(id);
    } else {
      set.add(id);
    }
    onChange([...set]);
  }

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-mute">{label}</p>
      <div className="flex flex-col gap-1.5">
        {options.map((id) => {
          const active = values.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-sm transition ${
                active
                  ? 'border-brand/40 bg-brand/10 text-fg'
                  : 'border-line-soft bg-ink-2 text-soft hover:border-line hover:text-fg'
              }`}
            >
              <ProviderIcon id={id} />
              <span className="flex-1 font-medium">{PROVIDER_LABELS[id] || id}</span>
              <span
                className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                  active
                    ? 'border-brand bg-brand text-white'
                    : 'border-line text-transparent'
                }`}
              >
                ✓
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md border border-line-soft bg-panel-2 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-mute">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-fg">{value}</p>
    </div>
  );
}

function EnvRow({ name, label, ok, required, hint, provider }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-soft bg-panel-2 px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        {provider && <ProviderIcon id={provider} className="mt-0.5" />}
        <div className="min-w-0">
          <p className="text-xs text-mute">{label}{required ? ' *' : ''}</p>
          <p className="truncate font-mono text-[11px] text-soft">{name || '—'}</p>
          {hint && <p className="mt-0.5 text-[11px] text-mute">value: {hint}</p>}
        </div>
      </div>
      <span className={`chip shrink-0 ${ok ? 'bg-ok/20 text-ok' : 'bg-warn/20 text-warn'}`}>
        {ok ? 'set' : 'missing'}
      </span>
    </li>
  );
}
