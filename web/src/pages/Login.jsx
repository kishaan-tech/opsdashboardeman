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
    <div className="flex h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-[1.35rem] border border-line-soft bg-panel p-7 shadow-[0_0_60px_rgba(77,143,255,0.1)]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">
            oh
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">ops-hub</h1>
            <p className="text-xs text-mute">Sign in with your Supabase user</p>
          </div>
        </div>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="username"
          className="field mb-2"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className="field mb-4"
        />
        {error && <p className="mb-3 text-xs text-danger">{error}</p>}
        <button disabled={busy} type="submit" className="btn btn-primary w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
