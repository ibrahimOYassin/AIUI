import crypto from 'node:crypto';
import { config } from './config.ts';

// ── Passwords ────────────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// ── Session tokens (HMAC-signed, no server-side state) ───────────────────────

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const sign = (data: string) => crypto.createHmac('sha256', config.secret).update(data).digest('base64url');

export interface TokenClaims {
  /** User id. */
  sub: string;
  /** Issued at / expires at, ms since epoch. */
  iat: number;
  exp: number;
  /** Admin who is signed in as `sub`, if any. */
  imp?: string;
}

export function createToken(userId: string, options: { impersonatorId?: string; ttlMs?: number } = {}): string {
  const issued = Date.now();
  const claims: TokenClaims = { sub: userId, iat: issued, exp: issued + (options.ttlMs ?? TOKEN_TTL_MS) };
  if (options.impersonatorId) claims.imp = options.impersonatorId;
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readToken(token: string): TokenClaims | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<TokenClaims>;
    if (typeof data.sub !== 'string' || typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    return { sub: data.sub, exp: data.exp, iat: typeof data.iat === 'number' ? data.iat : 0, imp: typeof data.imp === 'string' ? data.imp : undefined };
  } catch {
    return null;
  }
}

export function randomPassword(): string {
  return crypto.randomBytes(15).toString('base64url');
}

// ── Vault (AES-256-GCM) for connection secrets ───────────────────────────────

const vaultKey = crypto.createHash('sha256').update(`${config.secret}:vault`).digest();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decrypt(blob: string): string {
  const raw = Buffer.from(blob, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
