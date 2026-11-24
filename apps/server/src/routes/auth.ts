import crypto from 'node:crypto';
import { Router } from 'express';
import type { AuthResponse, ChangePasswordRequest, MeResponse, UpdateMeRequest } from '@aiui/shared';
import { config } from '../config.ts';
import { now, sql } from '../db.ts';
import {
  HttpError, type UserRow, clientIp, currentUser, emailAddress, ensureLocalUser, newPassword, rateLimiter, requireAuth, text, toUser, userRow,
} from '../http.ts';
import { getSettings, record } from '../platform.ts';
import { createToken, hashPassword, verifyPassword } from '../security.ts';

export const authRouter = Router();

const session = (row: UserRow): AuthResponse => ({ token: createToken(row.id), user: toUser(row) });

// Slow down password guessing and bulk sign-ups.
const loginByAccount = rateLimiter(8, 15 * 60_000);
const loginByAddress = rateLimiter(40, 15 * 60_000);
const registerByAddress = rateLimiter(20, 60 * 60_000);

authRouter.post('/auth/register', (req, res) => {
  if (config.mode === 'web' && !getSettings().allowRegistration)
    throw new HttpError(403, 'Sign-ups are closed. Ask an administrator for an account.');
  const ip = clientIp(req);
  registerByAddress.check(ip);
  const email = emailAddress(req.body?.email);
  const name = text(req.body?.name, 'name', 80);
  const password = newPassword(req.body?.password);
  if (sql.get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with this email already exists.');
  registerByAddress.hit(ip);
  const id = crypto.randomUUID();
  sql.run(
    'INSERT INTO users (id, email, name, password_hash, roles, developer_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, email, name, hashPassword(password), JSON.stringify(['user']), null, now(),
  );
  record({ userId: id }, 'auth.register', 'Created an account');
  res.status(201).json(session(userRow(id)!));
});

authRouter.post('/auth/login', (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ip = clientIp(req);
  loginByAccount.check(email);
  loginByAddress.check(ip);
  const row = sql.get<UserRow>('SELECT * FROM users WHERE email = ?', email);
  if (!row || !verifyPassword(password, row.password_hash)) {
    loginByAccount.hit(email);
    loginByAddress.hit(ip);
    record({ userId: row?.id ?? null }, 'auth.login_failed', `Failed sign-in for ${email.slice(0, 80) || '(no email)'}`);
    throw new HttpError(401, 'Wrong email or password.');
  }
  if (row.status !== 'active') throw new HttpError(403, 'This account has been deactivated. Contact an administrator.');
  loginByAccount.clear(email);
  record({ userId: row.id }, 'auth.login', 'Signed in');
  res.json(session(row));
});

/** Local mode: one owner, signed in automatically. */
authRouter.post('/auth/local', (_req, res) => {
  if (config.mode !== 'local') throw new HttpError(403, 'This server requires an account. Please sign in.');
  res.json(session(ensureLocalUser()));
});

authRouter.get('/auth/me', requireAuth, (req, res) => {
  const admin = req.impersonatorId ? userRow(req.impersonatorId) : undefined;
  res.json({ user: currentUser(req), impersonator: admin ? { id: admin.id, name: admin.name } : null } satisfies MeResponse);
});

authRouter.patch('/auth/me', requireAuth, (req, res) => {
  const user = currentUser(req);
  const body = (req.body ?? {}) as UpdateMeRequest;
  if (body.name !== undefined) sql.run('UPDATE users SET name = ? WHERE id = ?', text(body.name, 'name', 80), user.id);
  if (body.becomeDeveloper) {
    const developerName = text(body.developerName ?? user.developerName ?? user.name, 'developerName', 60);
    const roles = user.roles.includes('developer') ? user.roles : [...user.roles, 'developer'];
    sql.run('UPDATE users SET roles = ?, developer_name = ? WHERE id = ?', JSON.stringify(roles), developerName, user.id);
    if (!user.roles.includes('developer')) record(req, 'account.developer', `Became a developer as "${developerName}"`);
  } else if (body.developerName !== undefined && user.roles.includes('developer')) {
    sql.run('UPDATE users SET developer_name = ? WHERE id = ?', text(body.developerName, 'developerName', 60), user.id);
  }
  // An administrator looking around as someone else must not use up that person's welcome tips.
  if (typeof body.tipsSeen === 'boolean' && !req.impersonatorId) {
    sql.run('UPDATE users SET tips_seen_at = ? WHERE id = ?', body.tipsSeen ? now() : null, user.id);
  }
  res.json({ user: toUser(userRow(user.id)!) });
});

authRouter.post('/auth/password', requireAuth, (req, res) => {
  const user = currentUser(req);
  if (req.impersonatorId) throw new HttpError(403, 'Passwords cannot be changed while signed in as someone else. Use "Reset password" in the admin area.');
  const body = (req.body ?? {}) as ChangePasswordRequest;
  const row = userRow(user.id)!;
  if (typeof body.currentPassword !== 'string' || !verifyPassword(body.currentPassword, row.password_hash))
    throw new HttpError(400, 'The current password is not correct.');
  // Sessions started before this one are signed out; this one stays valid.
  sql.run('UPDATE users SET password_hash = ?, tokens_valid_after = ? WHERE id = ?', hashPassword(newPassword(body.newPassword)), req.tokenIssuedAt ?? 0, user.id);
  record(req, 'auth.password', 'Changed their password');
  res.json({ ok: true });
});
