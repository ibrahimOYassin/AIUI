import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCircle2, KeyRound, LogIn, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { AdminUserDetail, Role } from '@aiui/shared';
import { api, errorMessage } from '../../api';
import { Badge, Button, ErrorBox, Modal, Spinner } from '../../components/ui';
import { PROJECT_TYPES, shortDate, statNumber, timeAgo } from '../../lib/format';
import { useApp } from '../../stores/app';
import { ActivityRow } from './ActivityLog';
import { AdminOnly } from './AdminPage';
import { PasswordInput, RoleBadges, StatusBadge } from './UsersTab';

export function AdminUserPage() {
  return (
    <AdminOnly>
      <UserDetail />
    </AdminOnly>
  );
}

function UserDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const me = useApp((s) => s.user);
  const toast = useApp((s) => s.toast);
  const askConfirm = useApp((s) => s.askConfirm);
  const startImpersonation = useApp((s) => s.startImpersonation);
  const refreshSession = useApp((s) => s.refreshSession);
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'edit' | 'password' | 'delete' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUser(await api.adminUser(id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    setUser(null);
    void load();
  }, [load]);

  const back = (
    <Link to="/admin/users" className="back-link">
      <ArrowLeft size={14} /> Users
    </Link>
  );

  if (error) {
    return (
      <div className="page page-wide">
        {back}
        <ErrorBox message={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="page page-wide">
        {back}
        <Spinner label="Loading account…" />
      </div>
    );
  }

  const isSelf = me?.id === user.id;
  const isAdmin = user.roles.includes('admin');
  const disabled = user.status === 'disabled';

  /** Run an action, show the server's message on refusal, then reload the account. */
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast('success', done);
      await load();
      if (isSelf) await refreshSession();
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const setRole = (role: Exclude<Role, 'user'>, on: boolean) => {
    const roles = new Set<Role>(user.roles);
    roles.add('user');
    if (on) roles.add(role);
    else roles.delete(role);
    const label = role === 'admin' ? 'Admin' : 'Developer';
    void act(`role:${role}`, () => api.adminUpdateUser(user.id, { roles: [...roles] }), on ? `${user.name} now has the ${label} role.` : `${label} role removed from ${user.name}.`);
  };

  const toggleStatus = async () => {
    if (!disabled) {
      const ok = await askConfirm({
        title: `Deactivate ${user.name}?`,
        message: 'They are signed out and cannot sign in or use the platform until the account is reactivated. Their projects and plugins are kept.',
        confirmLabel: 'Deactivate account',
        danger: true,
      });
      if (!ok) return;
      await act('status', () => api.adminUpdateUser(user.id, { status: 'disabled' }), `${user.name} was deactivated.`);
    } else {
      const ok = await askConfirm({
        title: `Reactivate ${user.name}?`,
        message: 'They will be able to sign in again with their existing password.',
        confirmLabel: 'Reactivate account',
      });
      if (!ok) return;
      await act('status', () => api.adminUpdateUser(user.id, { status: 'active' }), `${user.name} can sign in again.`);
    }
  };

  const impersonate = async () => {
    const ok = await askConfirm({
      title: `Sign in as ${user.name}?`,
      message: `You will see and use the platform exactly as ${user.name} does, for up to one hour. Everything you do is recorded as done by you. A bar at the top lets you return to your own account.`,
      confirmLabel: 'Sign in as this user',
    });
    if (!ok) return;
    setBusy('impersonate');
    try {
      await startImpersonation(user.id); // reloads the app on success
    } catch (err) {
      toast('error', errorMessage(err));
      setBusy(null);
    }
  };

  const impersonateBlocked = isSelf ? 'This is your own account.' : isAdmin ? 'Administrators cannot be impersonated.' : disabled ? 'Reactivate the account first.' : '';

  return (
    <div className="page page-wide">
      {back}
      <header className="card card-pad user-hero">
        <span className="avatar">{user.name.trim().charAt(0).toUpperCase() || '?'}</span>
        <div className="grow">
          <h1>
            {user.name} {isSelf && <Badge tone="accent">You</Badge>}
          </h1>
          <p className="muted">{user.email}</p>
          <div className="row-center wrap muted small">
            <RoleBadges roles={user.roles} />
            <StatusBadge status={user.status} />
            <span>Joined {shortDate(user.createdAt)}</span>
            <span>·</span>
            <span title={user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : undefined}>{user.lastSeenAt ? `Last seen ${timeAgo(user.lastSeenAt)}` : 'Never seen'}</span>
            <span>·</span>
            <span>{user.lastLoginAt ? `Last sign-in ${timeAgo(user.lastLoginAt)}` : 'Has not signed in yet'}</span>
            {user.developerName && (
              <>
                <span>·</span>
                <span>Publishes as “{user.developerName}”</span>
              </>
            )}
          </div>
        </div>
        <div className="user-actions">
          <Button icon={<Pencil size={14} />} onClick={() => setDialog('edit')}>
            Edit
          </Button>
          <Button icon={<KeyRound size={14} />} onClick={() => setDialog('password')}>
            Reset password
          </Button>
          <Button icon={<LogIn size={14} />} busy={busy === 'impersonate'} disabled={!!impersonateBlocked} title={impersonateBlocked || 'See the platform as this person does'} onClick={() => void impersonate()}>
            Sign in as this user
          </Button>
        </div>
      </header>

      <div className="stat-grid stat-grid-6">
        <Count label="Projects" value={user.projectCount} />
        <Count label="Runs" value={user.runCount} />
        <Count label="Code exports" value={user.exportCount} />
        <Count label="Connections" value={user.connectionCount} />
        <Count label="Plugins installed" value={user.installedPluginCount} />
        <Count label="Sign-ins" value={user.loginCount} />
      </div>

      <div className="detail-cols">
        <div>
          <section className="card">
            <header className="card-head">
              <h3>Projects</h3>
              <span className="muted small">{user.projects.length} total</span>
            </header>
            {user.projects.length === 0 ? (
              <p className="card-pad muted">{user.name} has not created a project yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th className="num">Steps</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {user.projects.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          {p.description && <div className="muted small ellipsis cell-clip">{p.description}</div>}
                        </td>
                        <td>
                          <Badge tone={p.type === 'agent' ? 'purple' : p.type === 'solution' ? 'green' : 'blue'}>{PROJECT_TYPES[p.type]?.label ?? p.type}</Badge>
                        </td>
                        <td className="num">{p.stepCount}</td>
                        <td title={new Date(p.updatedAt).toLocaleString()}>{timeAgo(p.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {user.projects.length > 0 && !impersonateBlocked && (
              <p className="card-foot-note muted small">To open one of these projects, use “Sign in as this user”.</p>
            )}
          </section>

          <section className="card activity">
            <header className="card-head">
              <h3>Recent activity</h3>
            </header>
            {user.recentActivity.length === 0 ? (
              <p className="card-pad muted">No activity recorded for this account yet.</p>
            ) : (
              <div className="activity-list">
                {user.recentActivity.map((e) => (
                  <ActivityRow key={e.id} event={e} showPerson={false} />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside>
          <section className="card card-pad">
            <h3>Roles</h3>
            <p className="muted small">What this person is allowed to do.</p>
            <div className="checklist">
              <label className="check">
                <input type="checkbox" checked disabled /> User <span className="muted small">— build and export projects</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={user.roles.includes('developer')} disabled={busy !== null} onChange={(e) => setRole('developer', e.target.checked)} /> Developer{' '}
                <span className="muted small">— publish plugins</span>
              </label>
              <label className="check" title={isSelf ? 'You cannot remove your own Admin role.' : undefined}>
                <input type="checkbox" checked={isAdmin} disabled={busy !== null || isSelf} onChange={(e) => setRole('admin', e.target.checked)} /> Admin{' '}
                <span className="muted small">— manage the platform</span>
              </label>
            </div>
            {isSelf && <p className="muted small">You cannot remove your own Admin role. Ask another administrator.</p>}
            {user.publishedPluginCount > 0 && (
              <p className="muted small">
                Has {user.publishedPluginCount} published plugin{user.publishedPluginCount === 1 ? '' : 's'}. <Link to="/admin/plugins">Manage plugins</Link>
              </p>
            )}
          </section>

          <section className="card card-pad danger-zone">
            <h3>Account access</h3>
            {isSelf ? (
              <p className="muted small">This is your own account, so it cannot be deactivated or deleted here.</p>
            ) : (
              <>
                <div className="danger-row">
                  <div>
                    <strong>{disabled ? 'Reactivate account' : 'Deactivate account'}</strong>
                    <p className="muted small">{disabled ? 'Let this person sign in again.' : 'Signs the person out and blocks sign-in. Nothing is deleted.'}</p>
                  </div>
                  <Button icon={disabled ? <RotateCcw size={14} /> : <Ban size={14} />} busy={busy === 'status'} onClick={() => void toggleStatus()}>
                    {disabled ? 'Reactivate' : 'Deactivate'}
                  </Button>
                </div>
                <div className="danger-row">
                  <div>
                    <strong>Delete account</strong>
                    <p className="muted small">Removes the account with its projects and connections. This cannot be undone.</p>
                  </div>
                  <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => setDialog('delete')}>
                    Delete
                  </Button>
                </div>
              </>
            )}
          </section>
        </aside>
      </div>

      {dialog === 'edit' && (
        <EditDialog
          user={user}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await load();
            if (isSelf) await refreshSession();
          }}
        />
      )}
      {dialog === 'password' && <PasswordDialog user={user} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <DeleteDialog
          user={user}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            navigate('/admin/users');
          }}
        />
      )}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="card stat-tile">
      <span className="stat-tile-label">{label}</span>
      <strong className="stat-tile-value">{statNumber(value)}</strong>
    </div>
  );
}

function EditDialog({ user, onClose, onSaved }: { user: AdminUserDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [developerName, setDeveloperName] = useState(user.developerName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showDeveloper = user.roles.includes('developer') || !!user.developerName;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Name and email cannot be empty.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.adminUpdateUser(user.id, {
        name: name.trim(),
        email: email.trim(),
        ...(showDeveloper && developerName.trim() !== (user.developerName ?? '') ? { developerName: developerName.trim() } : {}),
      });
      toast('success', 'Account details saved.');
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Edit ${user.name}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <form className="fields" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <div className="field-label">
            <label>Name</label>
          </div>
          <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <div className="field-label">
            <label>Email</label>
          </div>
          <input type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
          <div className="field-help">Changing it changes what the person types to sign in.</div>
        </div>
        {showDeveloper && (
          <div className="field">
            <div className="field-label">
              <label>Developer name</label>
            </div>
            <input type="text" value={developerName} onChange={(e) => setDeveloperName(e.target.value)} />
            <div className="field-help">Shown as the author on their Marketplace listings.</div>
          </div>
        )}
        {error && <div className="field-error auth-error">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function PasswordDialog({ user, onClose }: { user: AdminUserDetail; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (password.length < 8) {
      setError('The password needs at least 8 characters.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.adminSetPassword(user.id, password);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Reset password for ${user.name}`}
      onClose={onClose}
      width={520}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" busy={busy} disabled={!password} onClick={() => void submit()}>
              Set new password
            </Button>
          </>
        )
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {done
          ? 'The new password is active. Copy it and pass it on over a channel you trust — it is not shown again after you close this window.'
          : 'Type a new password or generate a strong one. The old password stops working straight away.'}
      </p>
      <div className="fields">
        <div className="field">
          <div className="field-label">
            <label>New password</label>
          </div>
          <PasswordInput value={password} onChange={setPassword} readOnly={done} autoFocus />
          {!done && <div className="field-help">At least 8 characters.</div>}
        </div>
        {error && <div className="field-error auth-error">{error}</div>}
        {done && (
          <div className="test-result ok" style={{ marginTop: 0 }}>
            <CheckCircle2 size={16} />
            <span>Password changed for {user.email}.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

function DeleteDialog({ user, onClose, onDeleted }: { user: AdminUserDetail; onClose: () => void; onDeleted: () => void }) {
  const toast = useApp((s) => s.toast);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();

  const submit = async () => {
    if (!matches) return;
    setBusy(true);
    try {
      await api.adminDeleteUser(user.id);
      toast('success', `${user.name}'s account was deleted.`);
      onDeleted();
    } catch (err) {
      toast('error', errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Delete ${user.name}?`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" busy={busy} disabled={!matches} onClick={() => void submit()}>
            Delete account
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        This permanently deletes the account
        {user.projectCount > 0 ? `, its ${user.projectCount} project${user.projectCount === 1 ? '' : 's'}` : ''}
        {user.connectionCount > 0 ? ` and ${user.connectionCount} saved connection${user.connectionCount === 1 ? '' : 's'}` : ''}. It cannot be undone.
      </p>
      <p className="muted small">If you only want to stop this person from signing in, deactivate the account instead.</p>
      <div className="field">
        <div className="field-label">
          <label>
            Type <code>{user.email}</code> to confirm
          </label>
        </div>
        <input
          type="text"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </div>
    </Modal>
  );
}
