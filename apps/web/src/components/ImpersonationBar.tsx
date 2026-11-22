import { ArrowLeft, UserCog } from 'lucide-react';
import { useApp } from '../stores/app';

/** Shown across the whole app while an administrator is signed in as another user. */
export function ImpersonationBar() {
  const user = useApp((s) => s.user);
  const impersonator = useApp((s) => s.impersonator);
  const stop = useApp((s) => s.stopImpersonation);
  if (!user || !impersonator) return null;
  return (
    <div className="impersonation-bar" role="status">
      <UserCog size={16} />
      <span className="grow">
        You are signed in as <strong>{user.name}</strong> ({user.email}). Everything you do is recorded as done by an administrator.
      </span>
      <button type="button" className="btn btn-sm impersonation-return" onClick={stop}>
        <ArrowLeft size={14} />
        <span>Return to admin</span>
      </button>
    </div>
  );
}
