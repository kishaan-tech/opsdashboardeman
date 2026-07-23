import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';

export default function AdminOrgsPage() {
  const [orgs, setOrgs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [createdEnv, setCreatedEnv] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.listOrgs();
      setOrgs(data.orgs || []);
    } catch (err) {
      setError(String(err.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createOrg(e) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setCreatedEnv(null);
    try {
      const data = await adminApi.createOrg({ name, slug: slug || undefined });
      setCreatedEnv(data.env_vars || null);
      setName('');
      setSlug('');
      await load();
    } catch (err) {
      setError(String(err.message ?? err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="border-b border-line-soft px-6 pt-6 pb-4">
        <h2 className="text-xl font-semibold tracking-tight">Platform admin</h2>
        <p className="mt-1 text-sm text-mute">
          Create client instances and invite team members (creates Supabase Auth users when needed). Secrets stay in Vercel env vars.
        </p>
      </header>

      <div className="space-y-6 p-6">
        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}

        {createdEnv && (
          <div className="rounded-xl border border-brand/30 bg-brand/10 p-4 text-sm">
            <p className="font-medium text-fg">Org created — add these in Vercel / .env</p>
            <ul className="mt-2 space-y-1 font-mono text-[11px] text-brand">
              <li>{createdEnv.webhook_secret}=…</li>
              <li>{createdEnv.calendly_pat}=…</li>
              <li>{createdEnv.typeform_api_key}=…</li>
              <li>{createdEnv.typeform_form_ids}=…</li>
            </ul>
            <button
              type="button"
              className="mt-2 text-xs text-mute underline"
              onClick={() => setCreatedEnv(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        <form onSubmit={createOrg} className="rounded-2xl border border-line-soft bg-panel-2 p-4">
          <h3 className="text-sm font-semibold text-fg">New client org</h3>
          <div className="mt-3 flex flex-wrap gap-3">
            <input
              className="min-w-[12rem] flex-1 rounded-xl border border-line-soft bg-panel px-3 py-2 text-sm"
              placeholder="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="min-w-[10rem] flex-1 rounded-xl border border-line-soft bg-panel px-3 py-2 text-sm font-mono"
              placeholder="slug (optional)"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>

        <div className="overflow-hidden rounded-2xl border border-line-soft">
          <table className="w-full text-left text-sm">
            <thead className="bg-elevated/50 text-[11px] uppercase tracking-wider text-mute">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Env secrets</th>
                <th className="px-4 py-3">Last webhook</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-mute">Loading…</td></tr>
              )}
              {!loading && orgs.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-mute">No orgs yet</td></tr>
              )}
              {orgs.map((o) => (
                <tr key={o.id} className="border-t border-line-soft">
                  <td className="px-4 py-3 font-medium">{o.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-mute">{o.slug}</td>
                  <td className="px-4 py-3">
                    <span className="chip">{o.status}</span>
                  </td>
                  <td className="px-4 py-3 text-mute">{o.member_count}</td>
                  <td className="px-4 py-3 text-mute">
                    {o.integrations?.status || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-mute">
                    {o.integrations?.last_webhook_at
                      ? new Date(o.integrations.last_webhook_at).toLocaleString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a href={`#/admin/orgs/${o.id}`} className="text-brand hover:underline">
                      Manage ›
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
