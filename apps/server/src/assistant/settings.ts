/**
 * How the administrator set up the AI Assistant. Stored as one row in the settings table;
 * the API key is encrypted with the server secret and never leaves the server.
 */
import type { AssistantInfo, AssistantSettings, SaveAssistantSettingsRequest } from '@aiui/shared';
import { sql } from '../db.ts';
import { HttpError } from '../http.ts';
import { decrypt, encrypt } from '../security.ts';

const KEY = 'assistant';
const KEY_SECRET = 'assistantApiKey';

/**
 * Out of the box the assistant uses a local Ollama model, so it costs nothing to run.
 * AIUI_ASSISTANT_BASE_URL / AIUI_ASSISTANT_MODEL / AIUI_ASSISTANT_PROVIDER change the starting
 * values; an administrator can change everything later in Admin -> Assistant.
 */
const envProvider = process.env.AIUI_ASSISTANT_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';

export const DEFAULT_ASSISTANT: AssistantSettings = {
  enabled: false,
  name: 'AIUI Assistant',
  greeting: 'Hi! I can answer questions about AIUI and about your own projects. What would you like to know?',
  provider: envProvider,
  model: process.env.AIUI_ASSISTANT_MODEL || (envProvider === 'anthropic' ? 'claude-opus-5-5' : 'lfm3'),
  baseUrl: (process.env.AIUI_ASSISTANT_BASE_URL || (envProvider === 'anthropic' ? '' : 'http://localhost:11434/v1')).replace(/\/+$/, ''),
  apiKeySet: false,
  instructions: '',
  knowledge: '',
  access: 'users',
  dailyLimit: 50,
};

const read = (key: string) => sql.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value;
const write = (key: string, value: string) =>
  sql.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);

export function assistantApiKey(): string {
  const stored = read(KEY_SECRET);
  if (!stored) return '';
  try {
    return decrypt(stored);
  } catch {
    return ''; // written with another server secret
  }
}

export function getAssistantSettings(): AssistantSettings {
  let stored: Partial<AssistantSettings> = {};
  try {
    stored = JSON.parse(read(KEY) ?? '{}') as Partial<AssistantSettings>;
  } catch {
    /* keep the defaults */
  }
  return { ...DEFAULT_ASSISTANT, ...stored, apiKeySet: !!assistantApiKey() };
}

function str(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `"${field}" must be text.`);
  if (value.length > max) throw new HttpError(400, `"${field}" is too long (max ${max} characters).`);
  return value.trim();
}

/** Checks and merges the changes; throws 400 on anything that does not fit. */
export function mergeAssistantSettings(body: SaveAssistantSettingsRequest, base = getAssistantSettings()): AssistantSettings {
  const next: AssistantSettings = { ...base };
  if (body.enabled !== undefined) next.enabled = body.enabled === true;
  if (body.name !== undefined) next.name = str(body.name, 'name', 60) || DEFAULT_ASSISTANT.name;
  if (body.greeting !== undefined) next.greeting = str(body.greeting, 'greeting', 500);
  if (body.provider !== undefined) {
    if (body.provider !== 'anthropic' && body.provider !== 'openai') throw new HttpError(400, 'Choose "anthropic" or "openai" as the provider.');
    next.provider = body.provider;
  }
  if (body.model !== undefined) next.model = str(body.model, 'model', 120);
  if (body.baseUrl !== undefined) {
    const url = str(body.baseUrl, 'baseUrl', 300).replace(/\/+$/, '');
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new HttpError(400, 'The base URL must start with http:// or https://.');
    next.baseUrl = url;
  }
  if (body.instructions !== undefined) next.instructions = str(body.instructions, 'instructions', 8000);
  if (body.knowledge !== undefined) next.knowledge = str(body.knowledge, 'knowledge', 50_000);
  if (body.access !== undefined) {
    if (body.access !== 'users' && body.access !== 'everyone') throw new HttpError(400, 'Choose who can use the assistant.');
    next.access = body.access;
  }
  if (body.dailyLimit !== undefined) {
    const limit = Number(body.dailyLimit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 100_000) throw new HttpError(400, 'The daily limit must be a whole number from 0 to 100000.');
    next.dailyLimit = limit;
  }
  if (!next.model) next.model = next.provider === DEFAULT_ASSISTANT.provider ? DEFAULT_ASSISTANT.model : next.provider === 'anthropic' ? 'claude-opus-5-5' : '';
  if (next.enabled && !next.model) throw new HttpError(400, 'Enter the model the assistant should use.');
  return next;
}

export function saveAssistantSettings(body: SaveAssistantSettingsRequest): AssistantSettings {
  const next = mergeAssistantSettings(body);
  const { apiKeySet: _ignored, ...stored } = next;
  write(KEY, JSON.stringify(stored));
  if (body.clearApiKey) sql.run('DELETE FROM settings WHERE key = ?', KEY_SECRET);
  else if (typeof body.apiKey === 'string' && body.apiKey.trim()) write(KEY_SECRET, encrypt(body.apiKey.trim()));
  return getAssistantSettings();
}

/** The public part, for /api/config. Null while the assistant is off. */
export function assistantInfo(): AssistantInfo | null {
  const s = getAssistantSettings();
  if (!s.enabled) return null;
  return { name: s.name, greeting: s.greeting, guests: s.access === 'everyone' };
}
