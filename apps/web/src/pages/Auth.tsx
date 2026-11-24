import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { Button } from '../components/ui';
import { PUBLIC_PAGES, usePageMeta } from '../lib/site';
import { useApp } from '../stores/app';

export function AuthPage({ mode }: { mode: 'signin' | 'register' }) {
  const signIn = useApp((s) => s.signIn);
  const allowRegistration = useApp((s) => s.config?.allowRegistration ?? true);
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const register = mode === 'register';
  usePageMeta(register ? PUBLIC_PAGES.register : PUBLIC_PAGES.signin);
  // Keep where the visitor was heading when they switch between signing in and signing up.
  const keep = location.state as { from?: string } | null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (register && password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const auth = register ? await api.register(email.trim(), name.trim(), password) : await api.login(email.trim(), password);
      await signIn(auth);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/signin' && from !== '/register' ? from : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (register && !allowRegistration) {
    return (
      <div className="auth">
        <div className="auth-card">
          <img className="boot-logo" src="/logo.svg" alt="AIUI" />
          <h1>Sign-ups are closed.</h1>
          <p className="muted">Ask an administrator for an account.</p>
          <Link to="/signin" className="btn btn-primary btn-md auth-submit">
            <span>Back to sign in</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={(e) => void submit(e)}>
        <img className="boot-logo" src="/logo.svg" alt="AIUI" />
        <h1>{register ? 'Create your AIUI account' : 'Sign in to AIUI'}</h1>
        <p className="muted">Build AI workflows and agents without writing code. One account for the IDE and the Marketplace.</p>
        {register && (
          <div className="field">
            <div className="field-label">
              <label htmlFor="auth-name">Your name</label>
            </div>
            <input id="auth-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
          </div>
        )}
        <div className="field">
          <div className="field-label">
            <label htmlFor="auth-email">Email</label>
          </div>
          <input id="auth-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus={!register} />
        </div>
        <div className="field">
          <div className="field-label">
            <label htmlFor="auth-password">Password</label>
          </div>
          <input
            id="auth-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={register ? 'new-password' : 'current-password'}
          />
          {register && <div className="field-help">At least 8 characters.</div>}
        </div>
        {error && <div className="field-error auth-error">{error}</div>}
        <Button variant="primary" type="submit" busy={busy} className="auth-submit">
          {register ? 'Create account' : 'Sign in'}
        </Button>
        <p className="muted small auth-switch">
          {register ? (
            <>
              Already have an account? <Link to="/signin" state={keep}>Sign in</Link>
            </>
          ) : allowRegistration ? (
            <>
              New here? <Link to="/register" state={keep}>Create an account</Link>
            </>
          ) : (
            <>Need an account? Ask an administrator to create one for you.</>
          )}
        </p>
        <p className="muted small auth-switch">
          <Link to="/">What is AIUI?</Link> · <Link to="/docs">Read the guide</Link>
        </p>
      </form>
    </div>
  );
}
