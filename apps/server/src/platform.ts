/**
 * Platform-wide state an administrator controls or reads:
 * settings (sign-ups, who may run), and the activity log behind the reports.
 */
import type { Request } from 'express';
import type { ActivityEvent, PlatformSettings, Role } from '@aiui/shared';
import { config } from './config.ts';
import { now, sql } from './db.ts';

// ───────────────────────────── Settings ─────────────────────────────

function defaults(): PlatformSettings {
  // AIUI_ALLOW_RUN, when given, decides the starting value. Otherwise: everyone on a
  // single-user local install, administrators only on a shared (web) install, because
  // Run executes generated code on the server.
  const explicit = process.env.AIUI_ALLOW_RUN;
  const runAccess: PlatformSettings['runAccess'] =
    explicit !== undefined && explicit !== '' ? (config.allowRun ? 'all' : 'none') : config.mode === 'local' ? 'all' : 'admins';
  return { allowRegistration: true, runAccess };
}

export function getSettings(): PlatformSettings {
  const stored = Object.fromEntries(sql.all<{ key: string; value: string }>('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
  const base = defaults();
  return {
    allowRegistration: stored.allowRegistration !== undefined ? stored.allowRegistration === 'true' : base.allowRegistration,
    runAccess: stored.runAccess === 'none' || stored.runAccess === 'admins' || stored.runAccess === 'all' ? stored.runAccess : base.runAccess,
  };
}

export function saveSettings(changes: Partial<PlatformSettings>): PlatformSettings {
  const upsert = (key: string, value: string) =>
    sql.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
  if (typeof changes.allowRegistration === 'boolean') upsert('allowRegistration', String(changes.allowRegistration));
  if (changes.runAccess === 'none' || changes.runAccess === 'admins' || changes.runAccess === 'all') upsert('runAccess', changes.runAccess);
  return getSettings();
}

export function canRun(roles: Role[]): boolean {
  const { runAccess } = getSettings();
  return runAccess === 'all' || (runAccess === 'admins' && roles.includes('admin'));
}

// ───────────────────────────── Activity ─────────────────────────────

interface Actor {
  userId: string | null;
  impersonatorId?: string | null;
}

/** Add a line to the activity log. `detail` is a short machine-readable value (a status, a language). */
export function record(actor: Actor | Request, type: string, summary: string, extra: { target?: string; detail?: string } = {}): void {
  const who: Actor = 'headers' in actor ? { userId: actor.user?.id ?? null, impersonatorId: actor.impersonatorId ?? null } : actor;
  sql.run(
    'INSERT INTO events (at, user_id, impersonator_id, type, summary, target, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
    now(), who.userId, who.impersonatorId ?? null, type, summary.slice(0, 300), extra.target ?? null, extra.detail ?? null,
  );
}

const lastTouch = new Map<string, number>();

/** Note that someone is using the platform right now (at most once a minute per person). */
export function touch(userId: string): void {
  const current = Date.now();
  if (current - (lastTouch.get(userId) ?? 0) < 60_000) return;
  lastTouch.set(userId, current);
  const stamp = now();
  sql.run('UPDATE users SET last_seen_at = ? WHERE id = ?', stamp, userId);
  sql.run('INSERT OR IGNORE INTO activity_days (user_id, day) VALUES (?, ?)', userId, stamp.slice(0, 10));
}

interface EventRow {
  id: number;
  at: string;
  type: string;
  summary: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  impersonator_id: string | null;
  impersonator_name: string | null;
}

export function listEvents(filter: { userId?: string; type?: string; before?: number; limit: number }): ActivityEvent[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.userId) {
    where.push('e.user_id = ?');
    params.push(filter.userId);
  }
  if (filter.type) {
    where.push("(e.type = ? OR e.type LIKE ? ESCAPE '\\')");
    params.push(filter.type, `${filter.type.replace(/[\\%_]/g, '\\$&')}.%`);
  }
  if (filter.before) {
    where.push('e.id < ?');
    params.push(filter.before);
  }
  const rows = sql.all<EventRow>(
    `SELECT e.id, e.at, e.type, e.summary, e.user_id, u.name AS user_name, u.email AS user_email,
            e.impersonator_id, i.name AS impersonator_name
     FROM events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN users i ON i.id = e.impersonator_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.id DESC LIMIT ?`,
    ...params, filter.limit,
  );
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    type: row.type,
    summary: row.summary,
    user: row.user_id && row.user_name ? { id: row.user_id, name: row.user_name, email: row.user_email ?? '' } : null,
    impersonator: row.impersonator_id ? { id: row.impersonator_id, name: row.impersonator_name ?? 'an administrator' } : null,
  }));
}
