// Thin client for /api/admin/* (platform admin portal).

import { supabase } from './supabase.js';

const base = () => import.meta.env.VITE_API_BASE || '';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('not signed in');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

async function request(path, options = {}) {
  const headers = await authHeaders();
  const res = await fetch(`${base()}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
  return body;
}

export const adminApi = {
  listOrgs: () => request('/api/admin/orgs'),
  getOrg: (id) => request(`/api/admin/orgs/${id}`),
  createOrg: (payload) => request('/api/admin/orgs', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateOrg: (id, payload) => request(`/api/admin/orgs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
  refreshIntegrations: (id) => request(`/api/admin/orgs/${id}/integrations`),
  inviteMember: (id, payload) => request(`/api/admin/orgs/${id}/members`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateMember: (orgId, memberId, payload) => request(
    `/api/admin/orgs/${orgId}/members/${memberId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  ),
  removeMember: (orgId, memberId) => request(
    `/api/admin/orgs/${orgId}/members/${memberId}`,
    { method: 'DELETE' },
  ),
  importCsv: (id, payload) => request(`/api/admin/orgs/${id}/import-csv`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  audit: (id) => request(`/api/admin/orgs/${id}/audit`),
};
