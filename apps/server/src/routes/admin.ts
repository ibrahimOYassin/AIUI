import crypto from 'node:crypto';
import { Router } from 'express';
import type {
  ActivityPage, AdminCreateUserRequest, AdminPlugin, AdminUpdatePluginRequest, AdminUpdateUserRequest, AdminUser, AdminUserDetail,
  AuthResponse, Graph, Language, PlatformSettings, ProjectSummary, ProjectType, ReportOverview, Role,
} from '@aiui/shared';
import { now, sql } from '../db.ts';
import {
  HttpError, type UserRow, activeAdminCount, currentUser, emailAddress, newPassword, requireAdmin, requireAuth, text, toUser, userRow,
} from '../http.ts';
import { getSettings, listEvents, record, saveSettings } from '../platform.ts';
import { SYSTEM_USER_ID } from '../plugins.ts';
import { createToken, hashPassword } from '../security.ts';
import { type PluginRow, toListing } from './market.ts';

export const adminRouter = Router();
adminRouter.use('/admin', requireAuth, requireAdmin);

const ROLES: Role[] = ['user', 'developer', 'admin'];
const IMPERSONATION_TTL_MS = 60 * 60 * 1000;

// ───────────────────────────── Users ─────────────────────────────

const count = (query: string, ...params: string[]) => sql.get<{ c: number }>(query, ...params)?.c ?? 0;

function toAdminUser(row: UserRow): AdminUser {
  const events = (type: string) => count('SELECT COUNT(*) AS c FROM events WHERE user_id = ? AND type = ?', row.id, type);
  return {
    ...toUser(row),
    projectCount: count('SELECT COUNT(*) AS c FROM projects WHERE owner_id = ?', row.id),
    connectionCount: count('SELECT COUNT(*) AS c FROM connections WHERE owner_id = ?', row.id),
    installedPluginCount: count('SELECT COUNT(*) AS c FROM installs WHERE user_id = ?', row.id),
    publishedPluginCount: count("SELECT COUNT(*) AS c FROM plugins WHERE developer_id = ? AND status = 'published'", row.id),
    runCount: events('project.run'),
    exportCount: events('project.export'),
    loginCount: events('auth.login'),
    lastLoginAt: sql.get<{ at: string }>("SELECT at FROM events WHERE user_id = ? AND type = 'auth.login' ORDER BY id DESC LIMIT 1", row.id)?.at ?? null,
  };
}

/** A real person's account: never the internal "system" publisher. */
function managedRow(id: string): UserRow {
  const row = id === SYSTEM_USER_ID ? undefined : userRow(id);
  if (!row) throw new HttpError(404, 'User not found.');
  return row;
}

const rolesOf = (row: UserRow) => JSON.parse(row.roles) as Role[];
const label = (row: UserRow) => `${row.name} (${row.email})`;

/** Refuse a change that would leave the platform without an administrator who can sign in. */
function keepAnAdmin(row: UserRow): void {
  if (rolesOf(row).includes('admin') && row.status === 'active' && activeAdminCount() <= 1)
    throw new HttpError(400, 'This is the only administrator. Make someone else an administrator first.');
}

adminRouter.get('/admin/users', (req, res) => {
  const search = (req.query.q ?? '').toString().trim().toLowerCase();
  const status = req.query.status === 'active' || req.query.status === 'disabled' ? req.query.status : undefined;
  const role = ROLES.includes(req.query.role as Role) ? (req.query.role as Role) : undefined;
  const rows = sql.all<UserRow>('SELECT * FROM users WHERE id != ?', SYSTEM_USER_ID)
    .filter((row) => !search || row.name.toLowerCase().includes(search) || row.email.toLowerCase().includes(search))
    .filter((row) => !status || row.status === status)
    .filter((row) => !role || rolesOf(row).includes(role))
    .sort((a, b) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? '') || b.created_at.localeCompare(a.created_at));
  res.json(rows.map(toAdminUser));
});

adminRouter.post('/admin/users', (req, res) => {
  const body = (req.body ?? {}) as AdminCreateUserRequest;
  const email = emailAddress(body.email);
  const name = text(body.name, 'name', 80);
  const password = newPassword(body.password);
  const roles = [...new Set<Role>(['user', ...(Array.isArray(body.roles) ? body.roles.filter((r) => ROLES.includes(r)) : [])])];
  if (sql.get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with this email already exists.');
  const id = crypto.randomUUID();
  sql.run(
    'INSERT INTO users (id, email, name, password_hash, roles, developer_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, email, name, hashPassword(password), JSON.stringify(roles), roles.includes('developer') ? name : null, now(),
  );
  record(req, 'admin.user.create', `Created the account ${name} (${email})`, { target: id });
  res.status(201).json(toAdminUser(userRow(id)!));
});

adminRouter.get('/admin/users/:id', (req, res) => {
  const row = managedRow(req.params.id);
  const projects = sql.all<{ id: string; name: string; description: string; type: ProjectType; graph: string; created_at: string; updated_at: string }>(
    'SELECT id, name, description, type, graph, created_at, updated_at FROM projects WHERE owner_id = ? ORDER BY updated_at DESC', row.id,
  ).map((p): ProjectSummary => ({
    id: p.id, name: p.name, description: p.description, type: p.type,
    stepCount: (JSON.parse(p.graph) as Graph).nodes.length, createdAt: p.created_at, updatedAt: p.updated_at,
  }));
  const detail: AdminUserDetail = { ...toAdminUser(row), projects, recentActivity: listEvents({ userId: row.id, limit: 30 }) };
  res.json(detail);
});

adminRouter.patch('/admin/users/:id', (req, res) => {
  const admin = currentUser(req);
  const row = managedRow(req.params.id);
  const body = (req.body ?? {}) as AdminUpdateUserRequest;
  const self = row.id === admin.id;
  const changes: string[] = [];

  if (body.status !== undefined && body.status !== row.status) {
    if (body.status !== 'active' && body.status !== 'disabled') throw new HttpError(400, 'Status must be "active" or "disabled".');
    if (body.status === 'disabled') {
      if (self) throw new HttpError(400, 'You cannot deactivate your own account.');
      keepAnAdmin(row);
    }
    sql.run('UPDATE users SET status = ? WHERE id = ?', body.status, row.id);
    record(req, body.status === 'disabled' ? 'admin.user.disable' : 'admin.user.enable',
      `${body.status === 'disabled' ? 'Deactivated' : 'Reactivated'} ${label(row)}`, { target: row.id });
  }

  if (body.roles !== undefined) {
    if (!Array.isArray(body.roles) || body.roles.some((r) => !ROLES.includes(r))) throw new HttpError(400, 'Unknown role.');
    const roles = [...new Set<Role>(['user', ...body.roles])];
    const before = rolesOf(row);
    if (before.includes('admin') && !roles.includes('admin')) {
      if (self) throw new HttpError(400, 'You cannot remove your own administrator role.');
      keepAnAdmin(row);
    }
    if (roles.slice().sort().join() !== before.slice().sort().join()) {
      sql.run('UPDATE users SET roles = ?, developer_name = COALESCE(developer_name, ?) WHERE id = ?',
        JSON.stringify(roles), roles.includes('developer') ? row.name : null, row.id);
      record(req, 'admin.user.roles', `Changed the roles of ${label(row)} to ${roles.join(', ')}`, { target: row.id });
    }
  }

  if (body.name !== undefined && body.name.trim() !== row.name) {
    sql.run('UPDATE users SET name = ? WHERE id = ?', text(body.name, 'name', 80), row.id);
    changes.push('name');
  }
  if (body.email !== undefined && body.email.trim().toLowerCase() !== row.email) {
    const email = emailAddress(body.email);
    if (sql.get('SELECT id FROM users WHERE email = ? AND id != ?', email, row.id)) throw new HttpError(409, 'Another account already uses this email.');
    sql.run('UPDATE users SET email = ? WHERE id = ?', email, row.id);
    changes.push('email');
  }
  if (body.developerName !== undefined && body.developerName.trim() !== (row.developer_name ?? '')) {
    sql.run('UPDATE users SET developer_name = ? WHERE id = ?', text(body.developerName, 'developerName', 60), row.id);
    changes.push('developer name');
  }
  if (changes.length) record(req, 'admin.user.update', `Changed the ${changes.join(' and ')} of ${label(row)}`, { target: row.id });
  res.json(toAdminUser(userRow(row.id)!));
});

adminRouter.post('/admin/users/:id/password', (req, res) => {
  const row = managedRow(req.params.id);
  // Every existing session of that person ends.
  sql.run('UPDATE users SET password_hash = ?, tokens_valid_after = ? WHERE id = ?', hashPassword(newPassword(req.body?.password)), Date.now(), row.id);
  record(req, 'admin.user.password', `Reset the password of ${label(row)}`, { target: row.id });
  res.json({ ok: true });
});

adminRouter.post('/admin/users/:id/impersonate', (req, res) => {
  const admin = currentUser(req);
  const row = managedRow(req.params.id);
  if (row.id === admin.id) throw new HttpError(400, 'You are already signed in as yourself.');
  if (rolesOf(row).includes('admin')) throw new HttpError(400, 'Administrators cannot be impersonated.');
  if (row.status !== 'active') throw new HttpError(400, 'Reactivate this account before signing in as it.');
  record(req, 'admin.user.impersonate', `Signed in as ${label(row)}`, { target: row.id });
  const response: AuthResponse = { token: createToken(row.id, { impersonatorId: admin.id, ttlMs: IMPERSONATION_TTL_MS }), user: toUser(row) };
  res.json(response);
});

adminRouter.delete('/admin/users/:id', (req, res) => {
  const admin = currentUser(req);
  const row = managedRow(req.params.id);
  if (row.id === admin.id) throw new HttpError(400, 'You cannot delete your own account.');
  keepAnAdmin(row);
  if (sql.get('SELECT id FROM plugins WHERE developer_id = ?', row.id))
    throw new HttpError(400, 'This person publishes plugins. Remove their plugins first, or deactivate the account instead.');
  if (sql.get('SELECT id FROM purchases WHERE user_id = ?', row.id))
    throw new HttpError(400, 'This person has bought plugins, and deleting the account would erase those sales. Deactivate the account instead.');
  // Projects, connections, installs and reviews go with the account (ON DELETE CASCADE).
  sql.run('DELETE FROM users WHERE id = ?', row.id);
  record(req, 'admin.user.delete', `Deleted the account ${label(row)}`, { target: row.id });
  res.status(204).end();
});

// ───────────────────────────── Reports ─────────────────────────────

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

adminRouter.get('/admin/reports/overview', (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const today = new Date();
  const daysAgo = (n: number) => dayOf(new Date(today.getTime() - n * 86_400_000));
  const start = daysAgo(days - 1); // first day of the period, inclusive
  const activeSince = (since: string) =>
    count('SELECT COUNT(DISTINCT user_id) AS c FROM activity_days WHERE day >= ?', since);
  const eventsSince = (type: string, extra = '') =>
    count(`SELECT COUNT(*) AS c FROM events WHERE type = ? AND at >= ? ${extra}`, type, start);
  const perDay = (query: string, ...params: string[]) =>
    new Map(sql.all<{ day: string; c: number }>(query, ...params).map((r) => [r.day, r.c]));

  const active = perDay('SELECT day, COUNT(*) AS c FROM activity_days WHERE day >= ? GROUP BY day', start);
  const signups = perDay('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM users WHERE id != ? AND created_at >= ? GROUP BY day', SYSTEM_USER_ID, start);
  const eventsPerDay = (type: string) =>
    perDay('SELECT substr(at, 1, 10) AS day, COUNT(*) AS c FROM events WHERE type = ? AND at >= ? GROUP BY day', type, start);
  const runs = eventsPerDay('project.run');
  const exports = eventsPerDay('project.export');
  const series: ReportOverview['series'] = [];
  for (let n = days - 1; n >= 0; n--) {
    const day = daysAgo(n);
    series.push({ day, activeUsers: active.get(day) ?? 0, signups: signups.get(day) ?? 0, runs: runs.get(day) ?? 0, exports: exports.get(day) ?? 0 });
  }

  const sales = sql.get<{ c: number; total: number | null }>('SELECT COUNT(*) AS c, SUM(price_cents) AS total FROM purchases');
  const overview: ReportOverview = {
    days,
    totals: {
      users: count('SELECT COUNT(*) AS c FROM users WHERE id != ?', SYSTEM_USER_ID),
      disabledUsers: count("SELECT COUNT(*) AS c FROM users WHERE status = 'disabled'"),
      activeToday: activeSince(daysAgo(0)),
      active7d: activeSince(daysAgo(6)),
      active30d: activeSince(daysAgo(29)),
      newUsersInPeriod: count('SELECT COUNT(*) AS c FROM users WHERE id != ? AND created_at >= ?', SYSTEM_USER_ID, start),
      projects: count('SELECT COUNT(*) AS c FROM projects'),
      connections: count('SELECT COUNT(*) AS c FROM connections'),
      runsInPeriod: eventsSince('project.run'),
      failedRunsInPeriod: eventsSince('project.run', "AND detail = 'error'"),
      exportsInPeriod: eventsSince('project.export'),
      pluginInstalls: count('SELECT COUNT(*) AS c FROM installs'),
      publishedPlugins: count("SELECT COUNT(*) AS c FROM plugins WHERE status = 'published'"),
      purchases: sales?.c ?? 0,
      revenueCents: sales?.total ?? 0,
    },
    series,
    projectsByType: sql.all<{ type: ProjectType; count: number }>('SELECT type, COUNT(*) AS count FROM projects GROUP BY type ORDER BY count DESC'),
    exportsByLanguage: sql.all<{ language: Language; count: number }>(
      "SELECT detail AS language, COUNT(*) AS count FROM events WHERE type = 'project.export' AND at >= ? AND detail IN ('python', 'csharp') GROUP BY detail ORDER BY count DESC", start),
    topPlugins: sql.all<{ id: string; name: string; installs: number }>(
      'SELECT p.id, p.name, COUNT(i.user_id) AS installs FROM plugins p JOIN installs i ON i.plugin_id = p.id GROUP BY p.id ORDER BY installs DESC, p.name LIMIT 8'),
    topUsers: sql.all<ReportOverview['topUsers'][number]>(
      `SELECT u.id, u.name, u.email,
              (SELECT COUNT(*) FROM activity_days d WHERE d.user_id = u.id AND d.day >= ?) AS activeDays,
              (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.type = 'project.run' AND e.at >= ?) AS runs,
              (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.type = 'project.export' AND e.at >= ?) AS exports,
              (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id) AS projects
       FROM users u WHERE u.id != ?
       ORDER BY activeDays DESC, runs DESC, projects DESC, u.name LIMIT 10`,
      start, start, start, SYSTEM_USER_ID,
    ).filter((u) => u.activeDays > 0 || u.runs > 0 || u.projects > 0),
  };
  res.json(overview);
});

adminRouter.get('/admin/reports/activity', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const before = Number(req.query.before) || undefined;
  const events = listEvents({
    userId: typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : undefined,
    type: typeof req.query.type === 'string' && /^[a-z_.]+$/.test(req.query.type) ? req.query.type : undefined,
    before, limit: limit + 1,
  });
  const page: ActivityPage = { events: events.slice(0, limit), nextBefore: events.length > limit ? events[limit - 1]!.id : null };
  res.json(page);
});

// ───────────────────────────── Marketplace moderation ─────────────────────────────

function toAdminPlugin(row: PluginRow, adminId: string): AdminPlugin {
  const sales = sql.get<{ c: number; total: number | null }>('SELECT COUNT(*) AS c, SUM(price_cents) AS total FROM purchases WHERE plugin_id = ?', row.id);
  return {
    ...toListing(row, adminId),
    developerEmail: userRow(row.developer_id)?.email ?? '',
    salesCount: sales?.c ?? 0,
    revenueCents: sales?.total ?? 0,
  };
}

function pluginRow(id: string): PluginRow {
  const row = sql.get<PluginRow>('SELECT * FROM plugins WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'Plugin not found.');
  return row;
}

adminRouter.get('/admin/plugins', (req, res) => {
  const admin = currentUser(req);
  res.json(sql.all<PluginRow>('SELECT * FROM plugins ORDER BY builtin DESC, name COLLATE NOCASE').map((row) => toAdminPlugin(row, admin.id)));
});

adminRouter.patch('/admin/plugins/:id', (req, res) => {
  const row = pluginRow(req.params.id);
  const body = (req.body ?? {}) as AdminUpdatePluginRequest;
  if (body.status !== undefined && body.status !== row.status) {
    if (body.status !== 'draft' && body.status !== 'published') throw new HttpError(400, 'Status must be "draft" or "published".');
    if (row.builtin === 1) throw new HttpError(400, 'Core plugins are part of the IDE and cannot be unpublished.');
    sql.run('UPDATE plugins SET status = ?, updated_at = ? WHERE id = ?', body.status, now(), row.id);
    record(req, body.status === 'published' ? 'admin.plugin.publish' : 'admin.plugin.unpublish',
      `${body.status === 'published' ? 'Published' : 'Unpublished'} the plugin "${row.name}"`, { target: row.id });
  }
  if (typeof body.official === 'boolean' && (row.official === 1) !== body.official) {
    sql.run('UPDATE plugins SET official = ? WHERE id = ?', body.official ? 1 : 0, row.id);
    record(req, 'admin.plugin.official', `${body.official ? 'Marked' : 'Unmarked'} the plugin "${row.name}" as official`, { target: row.id });
  }
  res.json(toAdminPlugin(pluginRow(row.id), currentUser(req).id));
});

adminRouter.delete('/admin/plugins/:id', (req, res) => {
  const row = pluginRow(req.params.id);
  if (row.developer_id === SYSTEM_USER_ID) throw new HttpError(400, 'Plugins that ship with AIUI cannot be deleted. Unpublish it instead.');
  if (sql.get('SELECT id FROM purchases WHERE plugin_id = ?', row.id))
    throw new HttpError(400, 'This plugin has been bought, so it cannot be deleted. Unpublish it instead.');
  sql.run('DELETE FROM plugins WHERE id = ?', row.id);
  record(req, 'admin.plugin.delete', `Deleted the plugin "${row.name}"`, { target: row.id });
  res.status(204).end();
});

// ───────────────────────────── Settings ─────────────────────────────

adminRouter.get('/admin/settings', (_req, res) => {
  res.json(getSettings());
});

adminRouter.put('/admin/settings', (req, res) => {
  const body = (req.body ?? {}) as Partial<PlatformSettings>;
  if (body.runAccess !== undefined && !['none', 'admins', 'all'].includes(body.runAccess)) throw new HttpError(400, 'Unknown value for "runAccess".');
  const before = getSettings();
  const after = saveSettings(body);
  if (before.allowRegistration !== after.allowRegistration)
    record(req, 'admin.settings', after.allowRegistration ? 'Opened sign-ups' : 'Closed sign-ups');
  if (before.runAccess !== after.runAccess)
    record(req, 'admin.settings', `Set who can run projects to ${{ none: 'nobody', admins: 'administrators only', all: 'everyone' }[after.runAccess]}`);
  res.json(after);
});
