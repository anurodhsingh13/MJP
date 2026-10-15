import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

type Account = { id: string; email: string };
type AuthSession = { mode: 'required' | 'local'; user: Account | null };

async function readSession(): Promise<AuthSession> {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Sign-in service is unavailable. Retry when the API is reachable.');
  const payload = await response.json() as Partial<AuthSession>;
  if ((payload.mode !== 'required' && payload.mode !== 'local') || (payload.user !== null && typeof payload.user !== 'object')) {
    throw new Error('The sign-in service returned an invalid session.');
  }
  return payload as AuthSession;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void readSession().then(value => {
      if (active) setSession(value);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to check sign-in status.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/auth/${registering ? 'register' : 'login'}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json() as { user?: Account; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to sign in.');
      if (!payload.user?.id || !payload.user.email) throw new Error('The sign-in service returned an invalid account.');
      setSession({ mode: 'required', user: payload.user });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in. Retry shortly.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Sign-out failed. Retry.');
      setSession({ mode: 'required', user: null });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-out failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="auth-shell" role="status">Checking sign-in status…</main>;
  if (error && !session) return <main className="auth-shell" role="alert"><p>{error}</p><button onClick={() => window.location.reload()}>Retry</button></main>;
  if (!session) return <main className="auth-shell" role="alert"><p>Sign-in status is unavailable.</p></main>;
  if (session.mode === 'required' && !session.user) {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={submit}>
          <p className="eyebrow">TerraScope • Crop health monitoring</p>
          <h1>{registering ? 'Create your account' : 'Sign in to your fields'}</h1>
          <p>Field records are private to their owner. Existing unclaimed records are not assigned to a new account automatically.</p>
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={160} />
          <label htmlFor="auth-password">Password</label>
          <input id="auth-password" name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={12} maxLength={256} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}</button>
          <button type="button" className="auth-switch" disabled={busy} onClick={() => { setRegistering(!registering); setError(''); }}>
            {registering ? 'Already have an account? Sign in' : 'New to TerraScope? Create an account'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <>
      {session.mode === 'required' && session.user && (
        <div className="auth-user-bar">
          <span>Signed in as {session.user.email}</span>
          {error && <span role="alert">{error}</span>}
          <button type="button" onClick={signOut} disabled={busy}>{busy ? 'Please wait…' : 'Sign out'}</button>
        </div>
      )}
      {children}
    </>
  );
}
