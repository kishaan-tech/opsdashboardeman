import { useCallback, useEffect, useState } from 'react';
import { supabase, configured } from './lib/supabase.js';
import config from './config/entities.json';
import EntityPage from './pages/EntityPage.jsx';
import EventsPage from './pages/EventsPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import MatchesPage from './pages/MatchesPage.jsx';
import PostCallPage from './pages/PostCallPage.jsx';
import PerformancePage from './pages/PerformancePage.jsx';
import CommissionsPage from './pages/CommissionsPage.jsx';
import OverduePcfsPage from './pages/OverduePcfsPage.jsx';
import Login from './pages/Login.jsx';
import { overduePcfs, repsById } from './lib/metrics.js';

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
  };
}

export default function App() {
  const route = useHashRoute();
  const [session, setSession] = useState(undefined);
  const [overdueCount, setOverdueCount] = useState(null);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshOverdue = useCallback(async () => {
    if (!configured) return;
    const [b, r] = await Promise.all([
      supabase.from('bookings').select('id, start_time, showed_up, set_by, set_by_id, closer_id, sales_reps'),
      supabase.from('sales_reps').select('id, rep_name'),
    ]);
    if (b.error || r.error) return;
    setOverdueCount(overduePcfs(b.data || [], repsById(r.data || [])).length);
  }, []);

  useEffect(() => {
    if (!session) return;
    refreshOverdue();
    const t = setInterval(refreshOverdue, 60_000);
    return () => clearInterval(t);
  }, [session, refreshOverdue]);

  if (!configured) return <ConfigNotice />;
  if (session === undefined) return null;
  if (!session) return <Login />;

  const entity = config.entities.find((e) => e.table === route.table) ?? config.entities[0];
  const email = session.user?.email ?? '';

  return (
    <div className="flex h-screen text-fg">
      <aside className="flex w-[15.5rem] shrink-0 flex-col px-3 py-4">
        <div className="mb-6 px-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-sm font-bold tracking-tight text-white">
              oh
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">ops-hub</p>
              <p className="text-[11px] text-mute">internal ops</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          <NavSection label="Overview" />
          <NavLink href="#/dashboard" active={route.page === 'dashboard'}>Dashboard</NavLink>
          <NavLink href="#/performance" active={route.page === 'performance'}>Performance</NavLink>
          <NavLink href="#/commissions" active={route.page === 'commissions'}>Commissions</NavLink>
          <NavLink
            href="#/overdue-pcfs"
            active={route.page === 'overdue-pcfs'}
            badge={overdueCount}
          >
            Overdue PCFs
          </NavLink>

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

          <NavSection label="Ops" />
          <NavLink href="#/post-call" active={route.page === 'post-call'}>Post-call form</NavLink>
          <NavLink href="#/matches" active={route.page === 'matches'}>Same person</NavLink>
          <NavLink href="#/events" active={route.page === 'events'}>Events</NavLink>
        </nav>

        <div className="mt-3 space-y-2 border-t border-line-soft px-1 pt-3">
          <p className="truncate px-2 text-[11px] text-mute">{email}</p>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="w-full rounded-xl px-3 py-2 text-left text-xs text-mute transition hover:bg-elevated hover:text-fg"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col py-3 pr-3">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-line-soft bg-panel shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {route.page === 'dashboard' && <DashboardPage />}
          {route.page === 'performance' && <PerformancePage />}
          {route.page === 'commissions' && <CommissionsPage />}
          {route.page === 'overdue-pcfs' && (
            <OverduePcfsPage onCount={setOverdueCount} />
          )}
          {route.page === 'post-call' && <PostCallPage bookingId={route.bookingId} />}
          {route.page === 'matches' && <MatchesPage />}
          {route.page === 'events' && <EventsPage />}
          {route.page === 'entity' && entity && (
            <EntityPage key={entity.table} entity={entity} recordId={route.recordId} />
          )}
        </div>
      </main>
    </div>
  );
}

function NavSection({ label }) {
  return (
    <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-mute/80">
      {label}
    </p>
  );
}

function NavLink({ href, active, children, badge }) {
  return (
    <a
      href={href}
      className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm transition ${
        active
          ? 'bg-brand/15 text-brand'
          : 'text-soft hover:bg-elevated/60 hover:text-fg'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
        <span className="truncate">{children}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {badge != null && badge > 0 && (
          <span className="chip bg-danger/20 text-danger">{badge > 99 ? '99+' : badge}</span>
        )}
        {active && <span className="text-brand/70">›</span>}
      </span>
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
