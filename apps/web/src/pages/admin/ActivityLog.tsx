import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, KeyRound, FolderKanban, Puzzle, ShieldCheck, CircleDot, Sparkles } from 'lucide-react';
import type { ActivityEvent, AdminUser } from '@aiui/shared';
import { api, errorMessage } from '../../api';
import { Button, ErrorBox, Spinner } from '../../components/ui';
import { dateTime, timeAgo } from '../../lib/format';

const TYPES: { id: string; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'auth', label: 'Sign-ins' },
  { id: 'project', label: 'Projects' },
  { id: 'plugin', label: 'Plugins' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'admin', label: 'Admin actions' },
];

function TypeIcon({ type }: { type: string }) {
  const prefix = type.split('.')[0];
  if (prefix === 'auth') return <KeyRound size={14} />;
  if (prefix === 'project') return <FolderKanban size={14} />;
  if (prefix === 'plugin') return <Puzzle size={14} />;
  if (prefix === 'admin') return <ShieldCheck size={14} />;
  if (prefix === 'assistant') return <Sparkles size={14} />;
  return <CircleDot size={14} />;
}

export function ActivityRow({ event, showPerson = true }: { event: ActivityEvent; showPerson?: boolean }) {
  return (
    <div className="activity-row">
      <span className={`activity-icon type-${event.type.split('.')[0]}`} title={event.type}>
        <TypeIcon type={event.type} />
      </span>
      <time className="activity-time" dateTime={event.at} title={timeAgo(event.at)}>
        {dateTime(event.at)}
      </time>
      {showPerson && (
        <span className="activity-person">
          {event.user ? (
            <Link to={`/admin/users/${encodeURIComponent(event.user.id)}`} title={event.user.email}>
              {event.user.name}
            </Link>
          ) : (
            <span className="muted">Not signed in</span>
          )}
          {event.impersonator && <span className="by-admin">by admin {event.impersonator.name}</span>}
        </span>
      )}
      <span className="activity-summary">
        {event.summary}
        {!showPerson && event.impersonator && <span className="by-admin">by admin {event.impersonator.name}</span>}
      </span>
    </div>
  );
}

/** The platform's activity log with type and person filters and "Load more". */
export function ActivityLog({ users }: { users: AdminUser[] }) {
  const [type, setType] = useState('');
  const [userId, setUserId] = useState('');
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const page = await api.adminActivity({ type: type || undefined, userId: userId || undefined, limit: 50 });
      if (mine !== seq.current) return;
      setEvents(page.events);
      setNextBefore(page.nextBefore);
    } catch (err) {
      if (mine === seq.current) setError(errorMessage(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [type, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (nextBefore === null) return;
    const mine = seq.current;
    setMore(true);
    try {
      const page = await api.adminActivity({ type: type || undefined, userId: userId || undefined, before: nextBefore, limit: 50 });
      if (mine !== seq.current) return;
      setEvents((prev) => [...(prev ?? []), ...page.events]);
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMore(false);
    }
  };

  const filtered = !!(type || userId);

  return (
    <section className="card activity">
      <header className="activity-head">
        <h3 className="row-center">
          <History size={16} /> Activity log
        </h3>
        <span className="grow" />
        <div className="segmented" role="tablist" aria-label="Kind of activity">
          {TYPES.map((t) => (
            <button key={t.id || 'all'} type="button" role="tab" aria-selected={type === t.id} className={type === t.id ? 'active' : ''} onClick={() => setType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <select className="select-sm" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
      </header>
      {error && (
        <div className="card-pad">
          <ErrorBox message={error} onRetry={() => void load()} />
        </div>
      )}
      {!error && events === null && (
        <div className="card-pad">
          <Spinner label="Loading activity…" />
        </div>
      )}
      {!error && events && events.length === 0 && (
        <div className="chart-empty compact">
          <History size={20} />
          <span>{filtered ? 'No activity matches these filters.' : 'Nothing has happened yet. Sign-ins, project changes and admin actions will be listed here.'}</span>
          {filtered && (
            <Button
              size="sm"
              onClick={() => {
                setType('');
                setUserId('');
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}
      {!error && events && events.length > 0 && (
        <div className={`activity-list ${loading ? 'refreshing' : ''}`}>
          {events.map((e) => (
            <ActivityRow key={e.id} event={e} />
          ))}
        </div>
      )}
      {!error && events && events.length > 0 && (
        <footer className="activity-foot">
          {nextBefore !== null ? (
            <Button busy={more} onClick={() => void loadMore()}>
              Load more
            </Button>
          ) : (
            <span className="muted small">That is everything{filtered ? ' for these filters' : ''}.</span>
          )}
        </footer>
      )}
    </section>
  );
}
