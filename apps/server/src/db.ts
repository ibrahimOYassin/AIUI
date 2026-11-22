import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

export const db = new DatabaseSync(path.join(config.dataDir, 'aiui.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    roles TEXT NOT NULL DEFAULT '["user"]',
    developer_name TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    graph TEXT NOT NULL,
    settings TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);

  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    "values" TEXT NOT NULL,
    secrets TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS connections_owner ON connections(owner_id);

  CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    developer_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Other',
    icon TEXT NOT NULL DEFAULT 'box',
    tags TEXT NOT NULL DEFAULT '[]',
    price_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    official INTEGER NOT NULL DEFAULT 0,
    builtin INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plugin_versions (
    plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    manifest TEXT NOT NULL,
    changelog TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (plugin_id, version)
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plugin_id TEXT NOT NULL REFERENCES plugins(id),
    price_cents INTEGER NOT NULL,
    developer_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, plugin_id)
  );

  CREATE TABLE IF NOT EXISTS installs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, plugin_id)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, plugin_id)
  );
`);

// ── Upgrades for databases created by an earlier version ─────────────────────

function addColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
addColumn('users', 'last_seen_at', 'TEXT');
// Tokens issued before this moment (ms since epoch) are no longer accepted.
addColumn('users', 'tokens_valid_after', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
  -- What people do on the platform; feeds the admin reports and the activity log.
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id TEXT,
    impersonator_id TEXT,
    type TEXT NOT NULL,
    summary TEXT NOT NULL,
    target TEXT,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS events_user ON events(user_id, id);
  CREATE INDEX IF NOT EXISTS events_type ON events(type, at);

  -- One row per person per day they used the platform (for daily/weekly/monthly active users).
  CREATE TABLE IF NOT EXISTS activity_days (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  );
  CREATE INDEX IF NOT EXISTS activity_days_day ON activity_days(day);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

type Param = string | number | bigint | null | Uint8Array;

/** Thin helpers so route code reads as plain SQL. */
export const sql = {
  get<T = Record<string, unknown>>(query: string, ...params: Param[]): T | undefined {
    return db.prepare(query).get(...params) as T | undefined;
  },
  all<T = Record<string, unknown>>(query: string, ...params: Param[]): T[] {
    return db.prepare(query).all(...params) as T[];
  },
  run(query: string, ...params: Param[]): void {
    db.prepare(query).run(...params);
  },
  transaction<T>(work: () => T): T {
    db.exec('BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },
};

export const now = () => new Date().toISOString();
