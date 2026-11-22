import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { Role, User } from '@aiui/shared';
import { config } from './config.ts';
import { now, sql } from './db.ts';
import { canRun, touch } from './platform.ts';
import { hashPassword, randomPassword, readToken } from './security.ts';

/** Throw from any route to send `{ error }` with a status code. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  roles: string;
  developer_name: string | null;
  created_at: string;
  status: 'active' | 'disabled';
  last_seen_at: string | null;
  tokens_valid_after: number;
}

export function toUser(row: UserRow): User {
  const roles = JSON.parse(row.roles) as Role[];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roles,
    developerName: row.developer_name,
    createdAt: row.created_at,
    status: row.status,
    canRun: canRun(roles),
    lastSeenAt: row.last_seen_at,
  };
}

export const userRow = (id: string) => sql.get<UserRow>('SELECT * FROM users WHERE id = ?', id);

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    /** The admin acting as `user`, when this request uses an impersonation token. */
    impersonatorId?: string;
    /** When the token in use was issued (ms since epoch). */
    tokenIssuedAt?: number;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const claims = header.startsWith('Bearer ') ? readToken(header.slice(7)) : null;
  const row = claims ? userRow(claims.sub) : undefined;
  if (!claims || !row || row.status !== 'active' || claims.iat < row.tokens_valid_after) throw new HttpError(401, 'Please sign in.');
  if (claims.imp) {
    // An impersonation session lasts only while the admin behind it is still an active admin.
    const admin = userRow(claims.imp);
    if (!admin || admin.status !== 'active' || !(JSON.parse(admin.roles) as Role[]).includes('admin')) throw new HttpError(401, 'Please sign in.');
    req.impersonatorId = admin.id;
  } else {
    // Time spent impersonating does not count as the user's own activity.
    touch(row.id);
  }
  req.user = toUser(row);
  req.tokenIssuedAt = claims.iat;
  next();
}

export function currentUser(req: Request): User {
  if (!req.user) throw new HttpError(401, 'Please sign in.');
  return req.user;
}

export function requireDeveloper(req: Request): User {
  const user = currentUser(req);
  if (!user.roles.includes('developer')) throw new HttpError(403, 'Become a developer first (Account page).');
  return user;
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!currentUser(req).roles.includes('admin') || req.impersonatorId) throw new HttpError(403, 'Only administrators can do this.');
  next();
}

export const LOCAL_USER_ID = 'local';

/** The single owner account used in local mode. */
export function ensureLocalUser(): UserRow {
  const existing = userRow(LOCAL_USER_ID);
  if (existing) return existing;
  sql.run(
    'INSERT INTO users (id, email, name, password_hash, roles, developer_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    LOCAL_USER_ID, 'you@localhost', 'You', '!', JSON.stringify(['user', 'admin']), null, now(),
  );
  return userRow(LOCAL_USER_ID)!;
}

/**
 * Web mode: make sure an administrator who can sign in exists.
 *
 * Email and password come from AIUI_ADMIN_EMAIL / AIUI_ADMIN_PASSWORD. Without a password
 * a random one is generated and written to <data>/admin-password.txt (never to the log).
 * If this database was used in local mode before, that owner account becomes the
 * administrator, so its projects and connections are kept.
 */
export function seedAdmin(): void {
  if (config.mode !== 'web') return;
  const usable = sql.all<UserRow>("SELECT * FROM users WHERE status = 'active' AND password_hash != '!'")
    .some((row) => (JSON.parse(row.roles) as Role[]).includes('admin'));
  if (usable) return;

  const email = (process.env.AIUI_ADMIN_EMAIL || 'admin@aiui.local').trim().toLowerCase();
  const name = process.env.AIUI_ADMIN_NAME || 'Administrator';
  let password = process.env.AIUI_ADMIN_PASSWORD ?? '';
  let note = 'with the password from AIUI_ADMIN_PASSWORD';
  if (password.length < 8) {
    password = randomPassword();
    const file = path.join(config.dataDir, 'admin-password.txt');
    fs.writeFileSync(file, `${password}\n`, { mode: 0o600 });
    note = `its generated password is in ${file} — sign in, change it, then delete that file`;
  }

  const sameEmail = sql.get<UserRow>('SELECT * FROM users WHERE email = ?', email);
  const local = userRow(LOCAL_USER_ID);
  if (sameEmail) {
    const roles = new Set([...(JSON.parse(sameEmail.roles) as Role[]), 'admin' as Role]);
    sql.run("UPDATE users SET roles = ?, password_hash = ?, status = 'active' WHERE id = ?", JSON.stringify([...roles]), hashPassword(password), sameEmail.id);
  } else if (local) {
    sql.run(
      "UPDATE users SET email = ?, name = ?, password_hash = ?, roles = ?, status = 'active' WHERE id = ?",
      email, name, hashPassword(password), JSON.stringify([...new Set([...(JSON.parse(local.roles) as Role[]), 'user', 'admin'])]), local.id,
    );
  } else {
    sql.run(
      'INSERT INTO users (id, email, name, password_hash, roles, developer_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), email, name, hashPassword(password), JSON.stringify(['user', 'admin']), null, now(),
    );
  }
  console.log(`Administrator account ready: ${email} (${note}).`);
}

/** How many administrators can currently sign in. */
export function activeAdminCount(): number {
  return sql.all<UserRow>("SELECT * FROM users WHERE status = 'active' AND password_hash != '!'")
    .filter((row) => (JSON.parse(row.roles) as Role[]).includes('admin')).length;
}

export function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `"${field}" is required.`);
  if (value.length > max) throw new HttpError(400, `"${field}" is too long (max ${max} characters).`);
  return value.trim();
}

export function emailAddress(value: unknown): string {
  const email = text(value, 'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  return email;
}

export function newPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8) throw new HttpError(400, 'The password needs at least 8 characters.');
  if (value.length > 200) throw new HttpError(400, 'The password is too long.');
  return value;
}

/** The caller's address as Cloudflare / the reverse proxy reports it. */
export function clientIp(req: Request): string {
  const forwarded = req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

/** Simple in-memory limiter: at most `max` hits per key in `windowMs`. */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    /** Throws 429 when the key is over its limit. */
    check(key: string): void {
      const recent = (hits.get(key) ?? []).filter((at) => Date.now() - at < windowMs);
      hits.set(key, recent);
      if (recent.length >= max) throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
    },
    hit(key: string): void {
      hits.set(key, [...(hits.get(key) ?? []), Date.now()]);
      if (hits.size > 10_000) hits.clear();
    },
    clear(key: string): void {
      hits.delete(key);
    },
  };
}
