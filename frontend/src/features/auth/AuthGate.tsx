import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { usePreferences } from '../../lib/preferencesContext';
import { FarmerAccountContext } from './FarmerAccountContext';

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
  const {t}=usePreferences();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) { setPreferredName(''); setNameDraft(''); return; }
    try { const stored = localStorage.getItem('terrascope:display-name:' + userId) || ''; setPreferredName(stored); setNameDraft(stored); }
    catch { setPreferredName(''); setNameDraft(''); }
  }, [session?.user?.id]);
  const savePreferredName = () => {
    if (!session?.user) return;
    const name = nameDraft.trim().slice(0, 60);
    try { if (name) localStorage.setItem('terrascope:display-name:' + session.user.id, name);
      else localStorage.removeItem('terrascope:display-name:' + session.user.id);
      setPreferredName(name);
    } catch { setError(t('Could not save the name on this device.', 'इस डिवाइस पर नाम सेव नहीं हुआ।')); }
  };

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

  if (loading) return <main className="auth-shell" role="status">{t('Checking sign-in status…','साइन इन की स्थिति जाँच रहे हैं…')}</main>;
  if (error && !session) return <main className="auth-shell" role="alert"><p>{t('Sign-in service is unavailable. Please retry.', 'साइन इन सेवा उपलब्ध नहीं है। फिर कोशिश करें।')}</p><button onClick={() => window.location.reload()}>{t('Retry','फिर कोशिश करें')}</button></main>;
  if (!session) return <main className="auth-shell" role="alert"><p>Sign-in status is unavailable.</p></main>;
  if (session.mode === 'required' && !session.user) {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={submit}>
          <p className="eyebrow">{t('TerraScope • Crop health monitoring','TerraScope • फ़सल की निगरानी')}</p>
          <h1>{registering ? t('Create your account','अपना खाता बनाएँ') : t('Sign in to your fields','अपने खेत देखने के लिए साइन इन करें')}</h1>
          <p>{t('Your field records belong to your account. Old unclaimed fields must be assigned explicitly by the local administrator.', 'आपके खेत की जानकारी आपके खाते में रहती है। पुराने बिना खाते वाले खेत स्थानीय व्यवस्थापक को अलग से जोड़ने होंगे।')}</p>
          <label htmlFor="auth-email">{t('Email','ईमेल')}</label>
          <input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={160} />
          <label htmlFor="auth-password">{t('Password','पासवर्ड')}</label>
          <small>{t('Use at least 12 characters.', 'कम-से-कम 12 अक्षर रखें।')}</small>
          <input id="auth-password" name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={12} maxLength={256} />
          {error && <p className="auth-error" role="alert">{t(error, 'साइन इन नहीं हुआ। ईमेल और कम-से-कम 12 अक्षर वाला पासवर्ड जाँचें। बहुत कोशिश की हो तो 15 मिनट बाद फिर करें।')}</p>}
          <button type="submit" disabled={busy}>{busy ? t('Please wait…','कृपया रुकें…') : registering ? t('Create account','खाता बनाएँ') : t('Sign in','साइन इन करें')}</button>
          <button type="button" className="auth-switch" disabled={busy} onClick={() => { setRegistering(!registering); setError(''); }}>
            {registering ? t('Already have an account? Sign in','पहले से खाता है? साइन इन करें') : t('New to TerraScope? Create an account','पहली बार आए हैं? खाता बनाएँ')}
          </button>
        </form>
      </main>
    );
  }

  const farmerAccount = session.user ? {id:session.user.id,email:session.user.email,displayName:preferredName || session.user.email.split('@')[0] || t('Farmer','किसान')} : null;
  return (
    <FarmerAccountContext.Provider value={farmerAccount}>
      {session.mode === 'required' && session.user && (
        <div className="auth-user-bar">
          <details className="farmer-account-menu"><summary aria-label={t('Your account','आपका खाता')}> <span aria-hidden="true">👤</span> {farmerAccount?.displayName}</summary>
            <div className="farmer-account-menu-content"><strong>{t('Your account','आपका खाता')}</strong><span>{session.user.email}</span><label htmlFor="farmer-display-name">{t('Name for your greeting','स्वागत में दिखने वाला नाम')}</label>
              <input id="farmer-display-name" maxLength={60} value={nameDraft} onChange={event => setNameDraft(event.target.value)} placeholder={t('Enter your name','अपना नाम लिखें')}/>
              <button type="button" onClick={savePreferredName}>{t('Save name','नाम सेव करें')}</button>
              <small>{t('Saved only in this browser, not synced to another device.','नाम केवल इस ब्राउज़र में सेव होता है, दूसरे डिवाइस पर नहीं जाएगा।')}</small>
              <button type="button" onClick={signOut} disabled={busy}>{busy ? t('Please wait…','कृपया रुकें…') : t('Sign out','साइन आउट करें')}</button>
            </div>
          </details>
          {error && <span role="alert">{t(error,'साइन आउट नहीं हुआ। फिर कोशिश करें।')}</span>}
        </div>
      )}
      {children}
    </FarmerAccountContext.Provider>
  );
}
