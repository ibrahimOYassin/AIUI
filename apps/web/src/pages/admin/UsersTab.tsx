import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, Download, Search, UserPlus, Users, Wand2 } from 'lucide-react';
import type { AdminUser, Role } from '@aiui/shared';
import { api, downloadBlob, errorMessage } from '../../api';
import { Badge, Button, EmptyState, ErrorBox, Modal, Spinner } from '../../components/ui';
import { shortDate, timeAgo } from '../../lib/format';
import { copyText, generatePassword } from '../../lib/password';
import { useApp } from '../../stores/app';

export function RoleBadges({ roles }: { roles: Role[] }) {
  const extra = roles.filter((r) => r !== 'user');
  if (extra.length === 0) return <Badge tone="neutral">User</Badge>;
  return (
    <span className="row-center">
      {roles.includes('admin') && <Badge tone="red">Admin</Badge>}
      {roles.includes('developer') && <Badge tone="purple">Developer</Badge>}
    </span>
  );
}

export function StatusBadge({ status }: { status: AdminUser['status'] }) {
  return status === 'disabled' ? <Badge tone="amber">Deactivated</Badge> : <Badge tone="green">Active</Badge>;
}

/** A visible password box with "Generate" and "Copy", for passwords an admin hands to someone. */
export function PasswordInput({ value, onChange, autoFocus, readOnly }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; readOnly?: boolean }) {
  const [copied, setCopied] = useState(false);
  const toast = useApp((s) => s.toast);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } else toast('error', 'Could not copy. Select the password and copy it manually.');
  };
  return (
    <div className="password-row">
      <input type="text" className="mono" value={value} autoFocus={autoFocus} readOnly={readOnly} autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      {!readOnly && (
        <Button icon={<Wand2 size={14} />} onClick={() => onChange(generatePassword())} title="Fill in a strong random password">
          Generate
        </Button>
      )}
      <Button icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy()} disabled={!value}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function csvCell(value: string | number): string {
  let text = String(value ?? '');
  // stop spreadsheet apps from treating user-entered text as a formula
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv(users: AdminUser[]) {
  const header = ['Name', 'Email', 'Roles', 'Status', 'Joined', 'Last seen', 'Last sign-in', 'Sign-ins', 'Projects', 'Runs', 'Exports', 'Connections', 'Installed plugins', 'Published plugins'];
  const rows = users.map((u) => [
    u.name,
    u.email,
    u.roles.join(' '),
    u.status,
    u.createdAt,
    u.lastSeenAt ?? '',
    u.lastLoginAt ?? '',
    u.loginCount,
    u.projectCount,
    u.runCount,
    u.exportCount,
    u.connectionCount,
    u.installedPluginCount,
    u.publishedPluginCount,
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }), `aiui-users-${stamp}.csv`);
}

export function UsersTab() {
  const navigate = useNavigate();
  const me = useApp((s) => s.user);
  const toast = useApp((s) => s.toast);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'disabled'>('');
  const [role, setRole] = useState<'' | Role>('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const list = await api.adminUsers({ q: debounced || undefined, status: status || undefined, role: role || undefined });
      if (mine === seq.current) setUsers(list);
    } catch (err) {
      if (mine === seq.current) setError(errorMessage(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [debounced, status, role]);

  useEffect(() => {
    void load();
  }, [load]);

  // most recently seen first; people who never came back last
  const sorted = useMemo(
    () => (users ? [...users].sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '') || a.name.localeCompare(b.name)) : null),
    [users],
  );
  const filtered = !!(debounced || status || role);

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={15} />
          <input placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select-sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="disabled">Deactivated</option>
        </select>
        <select className="select-sm" value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="Role">
          <option value="">Any role</option>
          <option value="admin">Admins</option>
          <option value="developer">Developers</option>
          <option value="user">Users</option>
        </select>
        <span className="grow" />
        {sorted && (
          <span className="muted small">
            {sorted.length} {sorted.length === 1 ? 'person' : 'people'}
          </span>
        )}
        <Button
          icon={<Download size={15} />}
          disabled={!sorted || sorted.length === 0}
          onClick={() => {
            if (!sorted) return;
            exportCsv(sorted);
            toast('success', `Exported ${sorted.length} ${sorted.length === 1 ? 'person' : 'people'} to CSV.`);
          }}
          title="Download the list below as a spreadsheet file"
        >
          Export CSV
        </Button>
        <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => setCreating(true)}>
          New user
        </Button>
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!error && sorted === null && <Spinner label="Loading people…" />}
      {!error && sorted && sorted.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<Users size={24} />}
            title={filtered ? 'Nobody matches' : 'No accounts yet'}
            action={
              filtered ? (
                <Button
                  onClick={() => {
                    setQ('');
                    setStatus('');
                    setRole('');
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => setCreating(true)}>
                  New user
                </Button>
              )
            }
          >
            {filtered ? 'Try a different search or remove a filter.' : 'Create the first account for someone.'}
          </EmptyState>
        </div>
      )}
      {!error && sorted && sorted.length > 0 && (
        <div className={`card table-wrap ${loading ? 'refreshing' : ''}`}>
          <table className="table table-click">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Last seen</th>
                <th className="num">Projects</th>
                <th className="num">Runs</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr
                  key={u.id}
                  tabIndex={0}
                  onClick={() => navigate(`/admin/users/${encodeURIComponent(u.id)}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/admin/users/${encodeURIComponent(u.id)}`);
                  }}
                  className={u.status === 'disabled' ? 'dim' : ''}
                >
                  <td>
                    <strong>{u.name}</strong>
                    {me?.id === u.id && (
                      <>
                        {' '}
                        <Badge tone="accent">You</Badge>
                      </>
                    )}
                    <div className="muted small">{u.email}</div>
                  </td>
                  <td>
                    <RoleBadges roles={u.roles} />
                  </td>
                  <td>
                    <StatusBadge status={u.status} />
                  </td>
                  <td>{shortDate(u.createdAt)}</td>
                  <td title={u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : undefined}>{u.lastSeenAt ? timeAgo(u.lastSeenAt) : <span className="muted">Never</span>}</td>
                  <td className="num">{u.projectCount.toLocaleString()}</td>
                  <td className="num">{u.runCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NewUserDialog
          onClose={() => setCreating(false)}
          onCreated={(u) => {
            setCreating(false);
            navigate(`/admin/users/${encodeURIComponent(u.id)}`);
          }}
        />
      )}
    </>
  );
}

function NewUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (user: AdminUser) => void }) {
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [developer, setDeveloper] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Enter a name and an email address.');
      return;
    }
    if (password.length < 8) {
      setError('The password needs at least 8 characters.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const roles: Role[] = ['user', ...(developer ? (['developer'] as Role[]) : []), ...(admin ? (['admin'] as Role[]) : [])];
      const user = await api.adminCreateUser({ name: name.trim(), email: email.trim(), password, roles });
      toast('success', `Account created for ${user.name}. Share the password with them securely.`);
      onCreated(user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New user"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Create account
          </Button>
        </>
      }
    >
      <form className="fields" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <div className="field-label">
            <label>
              Name<span className="req">*</span>
            </label>
          </div>
          <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <div className="field-label">
            <label>
              Email<span className="req">*</span>
            </label>
          </div>
          <input type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
          <div className="field-help">They sign in with this address.</div>
        </div>
        <div className="field">
          <div className="field-label">
            <label>
              Password<span className="req">*</span>
            </label>
          </div>
          <PasswordInput value={password} onChange={setPassword} />
          <div className="field-help">Copy it now: it is not shown again. The person can change it on their Account page.</div>
        </div>
        <div className="field">
          <div className="field-label">
            <label>Roles</label>
          </div>
          <div className="checklist">
            <label className="check">
              <input type="checkbox" checked disabled /> User <span className="muted small">— build and export projects</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={developer} onChange={(e) => setDeveloper(e.target.checked)} /> Developer{' '}
              <span className="muted small">— publish plugins to the Marketplace</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Admin{' '}
              <span className="muted small">— manage people, plugins and settings</span>
            </label>
          </div>
        </div>
        {error && <div className="field-error auth-error">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
