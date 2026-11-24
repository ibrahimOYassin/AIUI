import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import type { Connection, ConnectionTypeDef, SaveConnectionRequest, TestConnectionResult } from '@aiui/shared';
import type { ResolvedConnection } from '../codegen/index.ts';
import { config } from '../config.ts';
import { now, sql } from '../db.ts';
import { HttpError, currentUser, requireAuth, text } from '../http.ts';
import { record } from '../platform.ts';
import { userRegistry } from '../plugins.ts';
import { decrypt, encrypt } from '../security.ts';

export const connectionsRouter = Router();
connectionsRouter.use(requireAuth);

interface ConnectionRow {
  id: string;
  owner_id: string;
  name: string;
  type: string;
  values: string;
  secrets: string;
  created_at: string;
}

function readSecrets(row: ConnectionRow): Record<string, string> {
  return JSON.parse(decrypt(row.secrets)) as Record<string, string>;
}

function toConnection(row: ConnectionRow): Connection {
  const secrets = readSecrets(row);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    values: JSON.parse(row.values) as Record<string, unknown>,
    secretsSet: Object.keys(secrets).filter((key) => secrets[key]),
    createdAt: row.created_at,
  };
}

/** Connections with decrypted secrets. Never sent to the browser. */
export function resolvedConnections(userId: string): ResolvedConnection[] {
  return sql.all<ConnectionRow>('SELECT * FROM connections WHERE owner_id = ?', userId).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    values: JSON.parse(row.values) as Record<string, unknown>,
    secrets: readSecrets(row),
  }));
}

function split(def: ConnectionTypeDef, input: Record<string, unknown>, previous: Record<string, string> = {}) {
  const values: Record<string, unknown> = {};
  const secrets: Record<string, string> = { ...previous };
  for (const field of def.fields) {
    const value = input[field.key];
    if (field.type === 'secret') {
      // An empty or missing secret keeps what is stored.
      if (typeof value === 'string' && value !== '') secrets[field.key] = value;
    } else if (value !== undefined) {
      values[field.key] = value;
    } else if (field.default !== undefined) {
      values[field.key] = field.default;
    }
  }
  return { values, secrets };
}

function definition(userId: string, type: string): ConnectionTypeDef {
  const def = userRegistry(userId).connectionTypes.get(type);
  if (!def) throw new HttpError(400, `Connection type "${type}" is not available. Install the plugin that provides it.`);
  return def;
}

function ownedRow(userId: string, id: string): ConnectionRow {
  const row = sql.get<ConnectionRow>('SELECT * FROM connections WHERE id = ? AND owner_id = ?', id, userId);
  if (!row) throw new HttpError(404, 'Connection not found.');
  return row;
}

connectionsRouter.get('/connections', (req, res) => {
  const rows = sql.all<ConnectionRow>('SELECT * FROM connections WHERE owner_id = ? ORDER BY name COLLATE NOCASE', currentUser(req).id);
  res.json(rows.map(toConnection));
});

connectionsRouter.post('/connections', (req, res) => {
  const user = currentUser(req);
  const body = (req.body ?? {}) as SaveConnectionRequest;
  const name = text(body.name, 'name', 80);
  const def = definition(user.id, text(body.type, 'type'));
  const { values, secrets } = split(def, body.values ?? {});
  const id = crypto.randomUUID();
  sql.run(
    'INSERT INTO connections (id, owner_id, name, type, "values", secrets, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, user.id, name, def.type, JSON.stringify(values), encrypt(JSON.stringify(secrets)), now(),
  );
  record(req, 'connection.create', `Added the connection "${name}" (${def.label})`, { target: id, detail: def.type });
  res.status(201).json(toConnection(ownedRow(user.id, id)));
});

connectionsRouter.put('/connections/:id', (req, res) => {
  const user = currentUser(req);
  const row = ownedRow(user.id, req.params.id);
  const body = (req.body ?? {}) as SaveConnectionRequest;
  const def = definition(user.id, row.type);
  const { values, secrets } = split(def, body.values ?? {}, readSecrets(row));
  sql.run(
    'UPDATE connections SET name = ?, "values" = ?, secrets = ? WHERE id = ?',
    text(body.name ?? row.name, 'name', 80), JSON.stringify(values), encrypt(JSON.stringify(secrets)), row.id,
  );
  res.json(toConnection(ownedRow(user.id, row.id)));
});

connectionsRouter.delete('/connections/:id', (req, res) => {
  const row = ownedRow(currentUser(req).id, req.params.id);
  sql.run('DELETE FROM connections WHERE id = ?', row.id);
  record(req, 'connection.delete', `Removed the connection "${row.name}"`, { target: row.id });
  res.status(204).end();
});

// ───────────────────────────── Testing a connection ─────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 10_000): Promise<Response> {
  // Redirects are not followed, so a public address cannot bounce the check to a private one.
  return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(ms) });
}

function tcpReachable(host: string, port: number, ms = 6000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, timeout: ms });
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('timed out')); });
    socket.once('error', reject);
  });
}

const privateRanges = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const)
  privateRanges.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) privateRanges.addSubnet(address, prefix, 'ipv6');

/**
 * On a shared install, people who are not administrators may only test connections to
 * public addresses. Otherwise "Test" would let anyone probe the server's own network.
 */
async function assertPublicTarget(type: string, v: Record<string, unknown>): Promise<void> {
  const raw = type === 'smtp' ? v.host : type === 'mcp' ? v.url : type === 'messaging_app' ? v.apiBase : v.baseUrl;
  if (typeof raw !== 'string' || !raw.trim()) return;
  let host = raw.trim();
  if (type !== 'smtp') {
    try {
      host = new URL(host).hostname;
    } catch {
      throw new HttpError(400, 'The address is not a valid URL.');
    }
  }
  host = host.replace(/^\[|\]$/g, '');
  const addresses = await dns.lookup(host, { all: true }).catch(() => []);
  if (addresses.some((a) => privateRanges.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4')))
    throw new HttpError(400, 'Only an administrator can test a connection to a private or local address.');
}

/** Messaging Bridge: asks each app who the bot is, without sending anything. */
async function testMessagingApp(str: (key: string) => string): Promise<TestConnectionResult> {
  const base = (fallback: string) => (str('apiBase') || fallback).replace(/\/+$/, '');
  const json = async (response: Response) => (await response.json().catch(() => null)) as Record<string, any> | null;
  switch (str('service') || 'telegram') {
    case 'telegram': {
      if (!str('token')) return { ok: false, message: 'Add the bot token from @BotFather.' };
      const response = await fetchWithTimeout(`${base('https://api.telegram.org')}/bot${str('token')}/getMe`);
      if (response.status === 401 || response.status === 404) return { ok: false, message: 'Telegram did not accept the bot token.' };
      if (!response.ok) return { ok: false, message: `Telegram answered ${response.status}.` };
      const bot = (await json(response))?.result;
      return { ok: true, message: `Connected to Telegram as @${bot?.username ?? 'your bot'}.` };
    }
    case 'discord': {
      if (!str('token')) return { ok: false, message: 'Add the bot token from the Discord Developer Portal.' };
      const api = base('https://discord.com/api/v10');
      const headers = { Authorization: `Bot ${str('token')}` };
      const me = await fetchWithTimeout(`${api}/users/@me`, { headers });
      if (me.status === 401) return { ok: false, message: 'Discord did not accept the bot token.' };
      if (!me.ok) return { ok: false, message: `Discord answered ${me.status}.` };
      const name = (await json(me))?.username ?? 'your bot';
      if (!str('channelId')) return { ok: true, message: `Connected to Discord as ${name}. Add a channel ID to receive messages.` };
      const channel = await fetchWithTimeout(`${api}/channels/${encodeURIComponent(str('channelId'))}`, { headers });
      if (!channel.ok) return { ok: false, message: `Connected as ${name}, but the bot cannot see channel ${str('channelId')} (${channel.status}). Invite it to the server.` };
      return { ok: true, message: `Connected to Discord as ${name}. It can see #${(await json(channel))?.name ?? str('channelId')}.` };
    }
    case 'whatsapp': {
      if (!str('accessToken') || !str('phoneNumberId')) return { ok: false, message: 'Add the access token and the phone number ID.' };
      const url = `${base('https://graph.facebook.com/v21.0')}/${encodeURIComponent(str('phoneNumberId'))}?fields=display_phone_number,verified_name`;
      const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${str('accessToken')}` } });
      const body = await json(response);
      if (!response.ok) return { ok: false, message: `WhatsApp answered ${response.status}: ${String(body?.error?.message ?? 'check the token and phone number ID').slice(0, 200)}` };
      return { ok: true, message: `Connected to WhatsApp. Sending from ${body?.display_phone_number ?? 'your number'}${body?.verified_name ? ` (${body.verified_name})` : ''}.` };
    }
    case 'teams':
      return { ok: true, message: 'Saved. Teams cannot check a webhook without posting to the channel, so it is checked when the first message is sent.' };
    default:
      return { ok: false, message: 'Choose which app this connection is for.' };
  }
}

async function testConnection(type: string, v: Record<string, unknown>): Promise<TestConnectionResult> {
  const str = (key: string) => (typeof v[key] === 'string' ? (v[key] as string).trim() : '');
  switch (type) {
    case 'llm': {
      const model = str('model');
      if (str('provider') === 'anthropic') {
        const client = new Anthropic({ apiKey: str('apiKey') || undefined, baseURL: str('baseUrl') || undefined, maxRetries: 0, timeout: 15_000 });
        try {
          const info = await client.models.retrieve(model || 'claude-opus-5-5');
          return { ok: true, message: `Connected. Model "${info.display_name}" is available.` };
        } catch (error) {
          if (error instanceof Anthropic.AuthenticationError) return { ok: false, message: 'The API key was rejected.' };
          if (error instanceof Anthropic.NotFoundError) return { ok: false, message: `The key works, but the model "${model}" was not found.` };
          if (error instanceof Anthropic.APIConnectionError) return { ok: false, message: 'Could not reach the Claude API.' };
          if (error instanceof Anthropic.APIError) return { ok: false, message: `Claude answered ${error.status}: ${error.message}` };
          throw error;
        }
      }
      const base = (str('baseUrl') || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const response = await fetchWithTimeout(`${base}/models`, { headers: str('apiKey') ? { Authorization: `Bearer ${str('apiKey')}` } : {} });
      if (response.status === 401 || response.status === 403) return { ok: false, message: 'The API key was rejected.' };
      if (!response.ok) return { ok: false, message: `The server answered ${response.status}.` };
      const body = (await response.json().catch(() => null)) as { data?: { id: string }[] } | null;
      const ids = body?.data?.map((m) => m.id) ?? [];
      if (model && ids.length && !ids.includes(model))
        return { ok: true, message: `Connected, but "${model}" is not in the server's model list (${ids.slice(0, 5).join(', ')}…).` };
      return { ok: true, message: `Connected. ${ids.length} model(s) available.` };
    }
    case 'http_api': {
      if (!str('baseUrl')) return { ok: true, message: 'Saved. Add a base URL to test reachability.' };
      const headers: Record<string, string> = {};
      if (str('authType') === 'bearer') headers.Authorization = `Bearer ${str('token')}`;
      if (str('authType') === 'header') headers[str('headerName') || 'X-API-Key'] = str('apiKey');
      if (str('authType') === 'basic') headers.Authorization = `Basic ${Buffer.from(`${str('username')}:${str('password')}`).toString('base64')}`;
      const response = await fetchWithTimeout(str('baseUrl'), { headers });
      if (response.status === 401 || response.status === 403) return { ok: false, message: `Reached the API, but the credentials were rejected (${response.status}).` };
      return { ok: true, message: `Reached the API (status ${response.status}).` };
    }
    case 'mcp': {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      if (str('token')) headers.Authorization = `Bearer ${str('token')}`;
      const response = await fetchWithTimeout(str('url'), {
        method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aiui', version: '1.0' } } }),
      });
      if (!response.ok) return { ok: false, message: `The MCP server answered ${response.status}.` };
      const match = (await response.text()).match(/"name"\s*:\s*"([^"]+)"/);
      return { ok: true, message: `Connected to MCP server${match ? ` "${match[1]}"` : ''}.` };
    }
    case 'smtp': {
      await tcpReachable(str('host'), Number(v.port) || 587);
      return { ok: true, message: `Reached ${str('host')}:${Number(v.port) || 587}. Credentials are checked when an email is sent.` };
    }
    case 'messaging_app':
      return testMessagingApp(str);
    default:
      return { ok: true, message: 'Saved. This kind of connection is checked the first time a step uses it.' };
  }
}

connectionsRouter.post('/connections/:id/test', async (req, res) => {
  const user = currentUser(req);
  const row = ownedRow(user.id, req.params.id);
  const values = { ...(JSON.parse(row.values) as Record<string, unknown>), ...readSecrets(row) };
  if (config.mode === 'web' && !user.roles.includes('admin')) await assertPublicTarget(row.type, values);
  let result: TestConnectionResult;
  try {
    result = await testConnection(row.type, values);
  } catch (error) {
    const reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    result = { ok: false, message: `Could not connect: ${reason}` };
  }
  res.json(result);
});
