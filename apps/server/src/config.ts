import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Repository root (apps/server/src → three levels up). */
export const ROOT = path.resolve(import.meta.dirname, '../../..');

// Command-line options work the same on every shell, unlike environment variables:
//   --web   --port 8080   --data ./my-data
const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const mode: 'local' | 'web' = process.env.AIUI_MODE === 'web' || process.argv.includes('--web') ? 'web' : 'local';
const dataDir = path.resolve(option('--data') ?? process.env.AIUI_DATA_DIR ?? path.join(ROOT, 'data'));
fs.mkdirSync(dataDir, { recursive: true });

function loadSecret(): string {
  if (process.env.AIUI_SECRET) return process.env.AIUI_SECRET;
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  // An empty value (as docker compose passes for an unset variable) means "use the default".
  return value === undefined || value === '' ? fallback : ['1', 'true', 'yes'].includes(value.toLowerCase());
}

export const config = {
  mode,
  port: Number(option('--port') ?? process.env.PORT ?? 4317),
  dataDir,
  secret: loadSecret(),
  /** Running generated code on the server is on by default only for a local, single-user install. */
  allowRun: flag('AIUI_ALLOW_RUN', mode === 'local'),
  runTimeoutMs: Number(process.env.AIUI_RUN_TIMEOUT_MS ?? 120_000),
  python: process.env.AIUI_PYTHON ?? 'python',
  pluginsDir: path.join(ROOT, 'plugins'),
  runtimeDir: path.join(ROOT, 'runtime'),
  webDist: path.join(ROOT, 'apps', 'web', 'dist'),
  version: '0.1.0',
  /** Share of a sale that goes to the plugin developer. */
  developerShare: 0.8,
};
