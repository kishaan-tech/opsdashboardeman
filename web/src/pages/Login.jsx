import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Email + password sign-in. Create your user in the Supabase dashboard
// (Authentication → Users → Add user) — there is no self-serve signup,
// this is an internal tool.
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-50">
      <form onSubmit={submit} className="w-80 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="font-semibold mb-1">ops-hub</h1>
        <p className="text-xs text-neutral-500 mb-4">Sign in with your Supabase user</p>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="email" autoComplete="username"
          className="mb-2 w-full rounded border border-neutral-300 px-3 py-2 text-sm" />
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="password" autoComplete="current-password"
          className="mb-3 w-full rounded border border-neutral-300 px-3 py-2 text-sm" />
        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
        <button disabled={busy}
          className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
