import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, configured } from './lib/supabase.js';
import config from './config/entities.json';
import EntityPage from './pages/EntityPage.jsx';
import EventsPage from './pages/EventsPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import CashReconcilePage from './pages/CashReconcilePage.jsx';
import MatchesPage from './pages/MatchesPage.jsx';
import PostCallPage from './pages/PostCallPage.jsx';
import PerformancePage from './pages/PerformancePage.jsx';
import CommissionsPage from './pages/CommissionsPage.jsx';
import OverduePcfsPage from './pages/OverduePcfsPage.jsx';
import AdminOrgsPage from './pages/AdminOrgsPage.jsx';
import AdminOrgDetailPage from './pages/AdminOrgDetailPage.jsx';
import Login from './pages/Login.jsx';
import { overduePcfs, repsById } from './lib/metrics.js';
import { OrgProvider, useOrg, scopeToOrg } from './lib/org.jsx';
import { canAccessPage } from './lib/permissions.js';

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return {
    page: parts[0] || 'dashboard',
    table: parts[0] === 'entity' ? parts[1] ?? config.entities[0]?.table : null,
    recordId: parts[0] === 'entity' && parts[2] === 'record' ? parts[3] : null,
    bookingId: parts[0] === 'post-call' ? parts[1] || null : null,
    adminOrgId: parts[0] === 'admin' && parts[1] === 'orgs' ? parts[2] || null : null,
  };
}

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!configured) return <ConfigNotice />;
  if (session === undefined) return null;
  if (!session) return <Login />;

  return (
    <OrgProvider>
      <AuthedShell session={session} />
    </OrgProvider>
  );
}

function AuthedShell({ session }) {
  const route = useHashRoute();
  const {
    loading: orgLoading,
    error: orgError,
    activeOrgId,
    setActiveOrgId,
    memberships,
    me,
    isPlatformAdmin,
    role,
    refresh,
  } = useOrg();
  const [overdueCount, setOverdueCount] = useState(null);

  const orgOptions = useMemo(() => {
    if (isPlatformAdmin && me?.orgs?.length) {
      return me.orgs.map((o) => ({ id: o.id, label: o.name, slug: o.slug }));
    }
    return (memberships || []).map((m) => ({
      id: m.org_id,
      label: m.org?.name || m.org_id,
      slug: m.org?.slug,
    }));
  }, [isPlatformAdmin, me, memberships]);

  const refreshOverdue = useCallback(async () => {
    if (!configured || !activeOrgId) return;
    const [b, r] = await Promise.all([
      scopeToOrg(
        supabase.from('bookings').select('id, start_time, showed_up, set_by_id, closer_id, sales_reps'),
        activeOrgId,
      ),
      scopeToOrg(supabase.from('sales_reps').select('id, rep_name'), activeOrgId),
    ]);
    if (b.error || r.error) return;
    setOverdueCount(overduePcfs(b.data || [], repsById(r.data || [])).length);
  }, [activeOrgId]);

  useEffect(() => {
    if (!session || !activeOrgId) return;
    refreshOverdue();
    const t = setInterval(refreshOverdue, 60_000);
    return () => clearInterval(t);
  }, [session, activeOrgId, refreshOverdue]);

  const entity = config.entities.find((e) => e.table === route.table) ?? config.entities[0];
  const email = session.user?.email ?? '';

  const pageKey = route.page === 'admin' ? 'admin' : route.page;
  const allowed = canAccessPage(role, pageKey);

  return (
    <div className="flex h-screen bg-ink text-fg">
      <aside className="flex w-[14.5rem] shrink-0 flex-col border-r border-line bg-panel">
        <div className="border-b border-line-soft px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-xs font-bold tracking-tight text-white">
              oh
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">ops-hub</p>
              <p className="truncate text-[11px] text-mute">Operations</p>
            </div>
          </div>
        </div>

        {orgOptions.length > 0 && (
          <div className="border-b border-line-soft px-3 py-3">
            <label className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-mute">
              Workspace
            </label>
            <select
              className="mt-1.5 w-full rounded-md border border-line bg-ink-2 px-2 py-1.5 text-xs text-fg outline-none focus:border-brand/50"
              value={activeOrgId || ''}
              onChange={(e) => setActiveOrgId(e.target.value || null)}
            >
              {!activeOrgId && <option value="">Select org…</option>}
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {(canAccessPage(role, 'dashboard')
            || canAccessPage(role, 'performance')
            || canAccessPage(role, 'commissions')
            || canAccessPage(role, 'overdue-pcfs')) && (
            <>
              <NavSection label="Overview" />
              {canAccessPage(role, 'dashboard') && (
                <NavLink href="#/dashboard" active={route.page === 'dashboard'}>Dashboard</NavLink>
              )}
              {canAccessPage(role, 'performance') && (
                <NavLink href="#/performance" active={route.page === 'performance'}>Performance</NavLink>
              )}
              {canAccessPage(role, 'commissions') && (
                <NavLink href="#/commissions" active={route.page === 'commissions'}>Commissions</NavLink>
              )}
              {canAccessPage(role, 'overdue-pcfs') && (
                <NavLink
                  href="#/overdue-pcfs"
                  active={route.page === 'overdue-pcfs'}
                  badge={overdueCount}
                >
                  Overdue PCFs
                </NavLink>
              )}
            </>
          )}

          {canAccessPage(role, 'entity') && (
            <>
              <NavSection label="Data" />
              {config.entities.map((e) => (
                <NavLink
                  key={e.table}
                  href={`#/entity/${e.table}`}
                  active={route.page === 'entity' && entity?.table === e.table}
                >
                  {e.label}
                </NavLink>
              ))}
            </>
          )}

          {canAccessPage(role, 'post-call') && (
            <>
              <NavSection label="Sales rep hub" />
              <NavLink href="#/post-call" active={route.page === 'post-call'}>Post-call form</NavLink>
            </>
          )}

          {(canAccessPage(role, 'matches')
            || canAccessPage(role, 'events')
            || canAccessPage(role, 'cash-reconcile')) && (
            <>
              <NavSection label="Ops" />
              {canAccessPage(role, 'matches') && (
                <NavLink href="#/matches" active={route.page === 'matches'}>Same person</NavLink>
              )}
              {canAccessPage(role, 'events') && (
                <NavLink href="#/events" active={route.page === 'events'}>Events</NavLink>
              )}
              {canAccessPage(role, 'cash-reconcile') && (
                <NavLink href="#/cash-reconcile" active={route.page === 'cash-reconcile'}>
                  Cash vs transactions
                </NavLink>
              )}
            </>
          )}

          {isPlatformAdmin && (
            <>
              <NavSection label="Platform" />
              <NavLink href="#/admin" active={route.page === 'admin'}>Admin portal</NavLink>
            </>
          )}
        </nav>

        <div className="space-y-1 border-t border-line-soft px-2 py-3">
          <p className="truncate px-2 text-[11px] text-mute">{email}</p>
          {role && (
            <p className="px-2 text-[10px] uppercase tracking-wider text-mute/70">{role}</p>
          )}
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="w-full rounded-md px-2.5 py-1.5 text-left text-xs text-mute transition hover:bg-elevated hover:text-fg"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ink-2">
        {orgLoading && (
          <div className="p-6 text-sm text-mute">Loading workspace…</div>
        )}
        {!orgLoading && orgError && (
          <div className="m-5 rounded-lg border border-warn/30 bg-warn/10 p-4 text-sm">
            <p className="font-medium text-fg">Could not load memberships</p>
            <p className="mt-1 text-mute">{orgError}</p>
            <p className="mt-2 text-xs text-mute">
              Apply migration 0008, ensure the API is running, and add yourself to{' '}
              <code className="font-mono text-brand">platform_admins</code> or an org membership.
            </p>
            <button type="button" className="mt-3 text-xs text-brand underline" onClick={refresh}>
              Retry
            </button>
          </div>
        )}
        {!orgLoading && !orgError && !activeOrgId && route.page !== 'admin' && (
          <div className="m-5 rounded-lg border border-line-soft bg-panel p-4 text-sm text-mute">
            Select a workspace, or open the Admin portal to create one.
          </div>
        )}
        {!orgLoading && !orgError && (activeOrgId || route.page === 'admin') && (
          <>
            {!allowed && (
              <div className="m-5 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
                Your role ({role || 'none'}) cannot access this page.
              </div>
            )}
            {allowed && route.page === 'admin' && !route.adminOrgId && <AdminOrgsPage />}
            {allowed && route.page === 'admin' && route.adminOrgId && (
              <AdminOrgDetailPage orgId={route.adminOrgId} />
            )}
            {allowed && route.page === 'dashboard' && <DashboardPage />}
            {allowed && route.page === 'performance' && <PerformancePage />}
            {allowed && route.page === 'commissions' && <CommissionsPage />}
            {allowed && route.page === 'overdue-pcfs' && (
              <OverduePcfsPage onCount={setOverdueCount} />
            )}
            {allowed && route.page === 'post-call' && <PostCallPage bookingId={route.bookingId} />}
            {allowed && route.page === 'matches' && <MatchesPage />}
            {allowed && route.page === 'events' && <EventsPage />}
            {allowed && route.page === 'cash-reconcile' && <CashReconcilePage />}
            {allowed && route.page === 'entity' && entity && (
              <EntityPage key={`${entity.table}-${activeOrgId}`} entity={entity} recordId={route.recordId} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function NavSection({ label }) {
  return (
    <p className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-mute first:pt-0">
      {label}
    </p>
  );
}

function NavLink({ href, active, children, badge }) {
  return (
    <a
      href={href}
      className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] transition ${
        active
          ? 'bg-elevated text-fg'
          : 'text-soft hover:bg-elevated/70 hover:text-fg'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
        <span className="truncate">{children}</span>
      </span>
      {badge != null && badge > 0 && (
        <span className="chip bg-danger/20 text-danger">{badge > 99 ? '99+' : badge}</span>
      )}
    </a>
  );
}

function ConfigNotice() {
  return (
    <div className="flex h-screen items-center justify-center p-8">
      <div className="max-w-md rounded-2xl border border-warn/30 bg-panel p-6 text-sm text-soft">
        <h2 className="mb-2 font-semibold text-fg">Supabase not configured</h2>
        <p>
          Set <code className="font-mono text-brand">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono text-brand">VITE_SUPABASE_ANON_KEY</code> in the repo-root{' '}
          <code className="font-mono">.env</code>, then restart the dev server.
        </p>
      </div>
    </div>
  );
}
