import { useEffect, useState } from 'react';
import { supabase, configured } from './lib/supabase.js';
import config from './config/entities.json';
import EntityPage from './pages/EntityPage.jsx';
import EventsPage from './pages/EventsPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import MatchesPage from './pages/MatchesPage.jsx';
import Login from './pages/Login.jsx';

// Tiny hash router: #/entity/<table>[/record/<id>] and #/events.
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
    recordId: parts[2] === 'record' ? parts[3] : null,
  };
}

export default function App() {
  const route = useHashRoute();
  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!configured) return <ConfigNotice />;
  if (session === undefined) return null;
  if (!session) return <Login />;

  const entity = config.entities.find((e) => e.table === route.table) ?? config.entities[0];

  return (
    <div className="flex h-screen bg-neutral-50 text-neutral-900">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white flex flex-col">
        <div className="px-4 py-4 border-b border-neutral-200">
          <h1 className="font-semibold tracking-tight">ops-hub</h1>
          <p className="text-xs text-neutral-500">internal operations</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <NavLink href="#/dashboard" active={route.page === 'dashboard'}>📊 Dashboard</NavLink>
          <div className="pt-2 mt-2 border-t border-neutral-200" />
          {config.entities.map((e) => (
            <NavLink key={e.table} href={`#/entity/${e.table}`}
              active={route.page === 'entity' && entity?.table === e.table}>
              {e.label}
            </NavLink>
          ))}
          <div className="pt-2 mt-2 border-t border-neutral-200">
            <NavLink href="#/matches" active={route.page === 'matches'}>Same person</NavLink>
            <NavLink href="#/events" active={route.page === 'events'}>⚡ Events</NavLink>
          </div>
        </nav>
        <button
          onClick={() => supabase.auth.signOut()}
          className="m-2 px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 text-left">
          Sign out
        </button>
      </aside>
      <main className="flex-1 overflow-hidden">
        {route.page === 'dashboard' && <DashboardPage />}
        {route.page === 'matches' && <MatchesPage />}
        {route.page === 'events' && <EventsPage />}
        {route.page === 'entity' && entity &&
          <EntityPage key={entity.table} entity={entity} recordId={route.recordId} />}
      </main>
    </div>
  );
}

function NavLink({ href, active, children }) {
  return (
    <a href={href}
      className={`block rounded px-3 py-1.5 text-sm ${
        active ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-neutral-100'}`}>
      {children}
    </a>
  );
}

function ConfigNotice() {
  return (
    <div className="flex h-screen items-center justify-center bg-neutral-50 p-8">
      <div className="max-w-md rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        <h2 className="font-semibold mb-2">Supabase not configured</h2>
        <p>Set <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in the repo-root{' '}
          <code className="font-mono">.env</code>, then restart the dev server.</p>
      </div>
    </div>
  );
}
