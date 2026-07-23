import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';

const OrgContext = createContext(null);

const STORAGE_KEY = 'ops-hub.active-org-id';

async function fetchMe() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const base = import.meta.env.VITE_API_BASE || '';
  const res = await fetch(`${base}/api/admin/me`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `me failed (${res.status})`);
  }
  return res.json();
}

export function OrgProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [me, setMe] = useState(null);
  const [activeOrgId, setActiveOrgIdState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || null,
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMe();
      setMe(data);
      const memberships = data?.memberships || [];
      const ids = new Set(memberships.map((m) => m.org_id));
      if (data?.is_platform_admin && data.orgs) {
        for (const o of data.orgs) ids.add(o.id);
      }
      let next = activeOrgId && ids.has(activeOrgId) ? activeOrgId : null;
      if (!next && memberships.length >= 1) {
        next = memberships[0].org_id;
      }
      if (!next && data?.orgs?.length) {
        next = data.orgs[0].id;
      }
      if (next) {
        setActiveOrgIdState(next);
        localStorage.setItem(STORAGE_KEY, next);
      }
    } catch (err) {
      setError(String(err.message ?? err));
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — load once per mount/session

  const setActiveOrgId = useCallback((id) => {
    setActiveOrgIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const membership = useMemo(
    () => (me?.memberships || []).find((m) => m.org_id === activeOrgId) || null,
    [me, activeOrgId],
  );

  const role = me?.is_platform_admin
    ? 'platform_admin'
    : membership?.role || null;

  const activeOrg = useMemo(() => {
    if (membership?.org) return membership.org;
    if (me?.is_platform_admin && activeOrgId && me?.orgs) {
      return me.orgs.find((o) => o.id === activeOrgId) || null;
    }
    return null;
  }, [membership, activeOrgId, me]);

  const value = useMemo(() => ({
    loading,
    error,
    me,
    refresh,
    isPlatformAdmin: Boolean(me?.is_platform_admin),
    memberships: me?.memberships || [],
    activeOrgId,
    setActiveOrgId,
    activeOrg,
    membership,
    role,
    salesRepId: membership?.sales_rep_id || null,
  }), [
    loading, error, me, refresh, activeOrgId, setActiveOrgId,
    activeOrg, membership, role,
  ]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}

/** Scope a supabase query to the active org (required for platform admins). */
export function scopeToOrg(query, orgId) {
  if (!orgId) return query;
  return query.eq('org_id', orgId);
}
