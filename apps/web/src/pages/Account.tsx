import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, KeyRound, LogOut } from 'lucide-react';
import { api, errorMessage } from '../api';
import { Badge, Button, PageHeader } from '../components/ui';
import { shortDate, timeAgo } from '../lib/format';
import { useApp } from '../stores/app';

export function AccountPage() {
  const user = useApp((s) => s.user)!;
  const config = useApp((s) => s.config);
  const setUser = useApp((s) => s.setUser);
  const signOut = useApp((s) => s.signOut);
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState(user.name);
  const [developerName, setDeveloperName] = useState(user.developerName ?? '');
  const [busy, setBusy] = useState(false);
  const isDeveloper = user.roles.includes('developer');
  const dirty = name.trim() !== user.name || (isDeveloper && developerName.trim() !== (user.developerName ?? ''));

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.updateMe({
        name: name.trim(),
        ...(isDeveloper && developerName.trim() ? { developerName: developerName.trim() } : {}),
      });
      setUser(updated);
      toast('success', 'Account updated.');
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <PageHeader title="Account" subtitle="The same account is used in the IDE and the Marketplace." />
      <section className="card card-pad">
        <div className="fields">
          <div className="field">
            <div className="field-label">
              <label>Name</label>
            </div>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <div className="field-label">
              <label>Email</label>
            </div>
            <input type="text" value={user.email} disabled />
          </div>
          <div className="field">
            <div className="field-label">
              <label>Roles</label>
            </div>
            <div className="row-center">
              {user.roles.map((r) => (
                <Badge key={r} tone={r === 'admin' ? 'red' : r === 'developer' ? 'purple' : 'neutral'}>
                  {r}
                </Badge>
              ))}
            </div>
          </div>
          {isDeveloper ? (
            <div className="field">
              <div className="field-label">
                <label>Developer name</label>
              </div>
              <input type="text" value={developerName} onChange={(e) => setDeveloperName(e.target.value)} />
              <div className="field-help">Shown as the author on your Marketplace listings.</div>
            </div>
          ) : (
            <div className="hint-box">
              Want to publish your own plugins? <Link to="/developer">Become a developer</Link> — it takes one click.
            </div>
          )}
          <div className="field-help">
            Member since {shortDate(user.createdAt)}
            {user.lastSeenAt ? ` · last active ${timeAgo(user.lastSeenAt)}` : ''}.
          </div>
        </div>
        <div className="card-actions">
          <Button variant="primary" onClick={() => void save()} busy={busy} disabled={!dirty || !name.trim()}>
            Save changes
          </Button>
        </div>
      </section>
      {config?.mode === 'web' && <ChangePassword />}
      {config?.mode === 'web' ? (
        <section className="card card-pad">
          <h3>Sign out</h3>
          <p className="muted">You will need your email and password to sign in again.</p>
          <Button icon={<LogOut size={15} />} onClick={signOut}>
            Sign out
          </Button>
        </section>
      ) : (
        <p className="muted small">AIUI is running in local mode on this computer, so you are signed in automatically.</p>
      )}
    </div>
  );
}

function ChangePassword() {
  const toast = useApp((s) => s.toast);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setDone(false);
    if (next.length < 8) {
      setError('Choose a new password with at least 8 characters.');
      return;
    }
    if (next !== repeat) {
      setError('The two new passwords do not match.');
      return;
    }
    if (next === current) {
      setError('The new password is the same as the current one.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
      toast('success', 'Password changed.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-pad">
      <h3 className="row-center">
        <KeyRound size={16} /> Change password
      </h3>
      <form className="fields" style={{ marginTop: 12 }} onSubmit={(e) => void submit(e)}>
        <div className="field">
          <div className="field-label">
            <label htmlFor="pw-current">Current password</label>
          </div>
          <input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="field">
          <div className="field-label">
            <label htmlFor="pw-new">New password</label>
          </div>
          <input id="pw-new" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
          <div className="field-help">At least 8 characters.</div>
        </div>
        <div className="field">
          <div className="field-label">
            <label htmlFor="pw-repeat">Repeat new password</label>
          </div>
          <input id="pw-repeat" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </div>
        {error && <div className="field-error auth-error">{error}</div>}
        {done && !error && (
          <div className="test-result ok" style={{ marginTop: 0 }}>
            <CheckCircle2 size={16} />
            <span>Your password was changed. Use it the next time you sign in.</span>
          </div>
        )}
        <div className="card-actions" style={{ marginTop: 0 }}>
          <Button variant="primary" type="submit" busy={busy} disabled={!current || !next || !repeat}>
            Change password
          </Button>
        </div>
      </form>
    </section>
  );
}
