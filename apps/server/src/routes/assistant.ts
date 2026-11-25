import { Router, type Request } from 'express';
import type { AssistantChatRequest, AssistantEvent, AssistantMessage, SaveAssistantSettingsRequest, TestConnectionResult } from '@aiui/shared';
import { chat, describeFailure } from '../assistant/chat.ts';
import { allDocs } from '../assistant/knowledge.ts';
import { assistantApiKey, getAssistantSettings, mergeAssistantSettings, saveAssistantSettings } from '../assistant/settings.ts';
import { sql } from '../db.ts';
import { HttpError, clientIp, currentUser, optionalAuth, rateLimiter, requireAdmin, requireAuth } from '../http.ts';
import { record } from '../platform.ts';

/**
 * The AI Assistant. Mounted before the routers that require a sign-in, because guests may use it
 * when the administrator allows that. Settings live under /admin/assistant.
 */
export const assistantRouter = Router();

const MAX_TURNS = 20;
const burst = rateLimiter(8, 60_000);
/** Guests have no account to count against, so their questions are counted per address, per day. */
const guestCounts = new Map<string, { day: string; count: number }>();

const today = () => new Date().toISOString().slice(0, 10);

function usedToday(req: Request): number {
  if (req.user) {
    return sql.get<{ c: number }>("SELECT COUNT(*) AS c FROM events WHERE user_id = ? AND type = 'assistant.ask' AND at >= ?", req.user.id, today())?.c ?? 0;
  }
  const entry = guestCounts.get(clientIp(req));
  return entry?.day === today() ? entry.count : 0;
}

function countQuestion(req: Request): void {
  if (req.user) return record(req, 'assistant.ask', 'Asked the AI Assistant');
  const ip = clientIp(req);
  const entry = guestCounts.get(ip);
  guestCounts.set(ip, { day: today(), count: entry?.day === today() ? entry.count + 1 : 1 });
  if (guestCounts.size > 20_000) guestCounts.clear();
}

/** Only plain user/assistant text turns; the newest last, ending with the question. */
function cleanMessages(input: unknown): AssistantMessage[] {
  if (!Array.isArray(input) || !input.length) throw new HttpError(400, 'Ask a question first.');
  const turns = input
    .filter((m): m is AssistantMessage => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim() !== '')
    .map((m) => ({ role: m.role, content: m.content.slice(0, m.role === 'user' ? 8000 : 16000) }))
    .slice(-MAX_TURNS);
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') throw new HttpError(400, 'The last message must be your question.');
  return turns;
}

assistantRouter.post('/assistant/chat', optionalAuth, async (req, res) => {
  const settings = getAssistantSettings();
  if (!settings.enabled) throw new HttpError(404, 'The assistant is turned off.');
  if (!req.user && settings.access !== 'everyone') throw new HttpError(401, 'Sign in to use the assistant.');
  const body = (req.body ?? {}) as AssistantChatRequest;
  const messages = cleanMessages(body.messages);

  const who = req.user ? `u:${req.user.id}` : `ip:${clientIp(req)}`;
  burst.check(who);
  const used = usedToday(req);
  if (settings.dailyLimit > 0 && used >= settings.dailyLimit)
    throw new HttpError(429, `You have asked ${settings.dailyLimit} questions today, the daily limit. Please come back tomorrow.`);
  burst.hit(who);
  countQuestion(req);

  const userId = req.user?.id ?? null;
  const project =
    userId && typeof body.projectId === 'string'
      ? sql.get<{ id: string; name: string }>('SELECT id, name FROM projects WHERE id = ? AND owner_id = ?', body.projectId, userId)
      : undefined;
  const page = typeof body.page === 'string' && /^\/[\w\-/.#?=&%]*$/.test(body.page) ? body.page.slice(0, 200) : undefined;

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const emit = (event: AssistantEvent) => {
    if (!res.writableEnded) res.write(JSON.stringify(event) + '\n');
  };
  // Stop paying for an answer nobody is waiting for.
  const abort = new AbortController();
  res.on('close', () => abort.abort());

  try {
    await chat({
      settings,
      apiKey: assistantApiKey(),
      messages,
      ctx: { userId, docs: allDocs(settings.knowledge), compact: settings.provider === 'openai', searched: new Set() },
      context: { userName: req.user?.name ?? null, page, project: project ?? undefined },
      emit,
      signal: abort.signal,
    });
    emit({ type: 'done', remaining: settings.dailyLimit > 0 ? Math.max(0, settings.dailyLimit - used - 1) : null });
  } catch (error) {
    if (!abort.signal.aborted) {
      console.error('Assistant failed:', error);
      emit({ type: 'error', message: describeFailure(error, settings.provider) });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// ───────────────────────────── Settings (administrators) ─────────────────────────────

assistantRouter.get('/admin/assistant', requireAuth, requireAdmin, (_req, res) => {
  res.json(getAssistantSettings());
});

assistantRouter.put('/admin/assistant', requireAuth, requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as SaveAssistantSettingsRequest;
  const before = getAssistantSettings();
  const after = saveAssistantSettings(body);
  const changes: string[] = [];
  if (before.enabled !== after.enabled) changes.push(after.enabled ? 'turned the AI Assistant on' : 'turned the AI Assistant off');
  if (before.provider !== after.provider || before.model !== after.model) changes.push(`set its model to ${after.model}`);
  if (before.access !== after.access) changes.push(after.access === 'everyone' ? 'let guests use it' : 'limited it to signed-in people');
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) changes.push('changed its API key');
  if (body.clearApiKey) changes.push('removed its API key');
  const summary = changes.length ? changes.join(', ') : 'updated the AI Assistant settings';
  record(req, 'admin.settings', summary.charAt(0).toUpperCase() + summary.slice(1));
  res.json(after);
});

/** Asks the model for one short sentence with the settings being edited (saved or not). */
assistantRouter.post('/admin/assistant/test', requireAuth, requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as SaveAssistantSettingsRequest;
  const settings = mergeAssistantSettings({ ...body, enabled: false });
  const apiKey = body.clearApiKey ? '' : typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : assistantApiKey();
  let text = '';
  let failure = '';
  try {
    await chat({
      settings,
      apiKey,
      messages: [{ role: 'user', content: 'This is a connection test. Reply with one short friendly sentence that says who you are.' }],
      noTools: true,
      ctx: { userId: null, docs: [] },
      context: { userName: currentUser(req).name },
      emit: (event) => {
        if (event.type === 'text') text += event.text;
        if (event.type === 'error') failure = event.message;
      },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    console.error('Assistant test failed:', error);
    failure = describeFailure(error, settings.provider).replace(' Please tell the administrator.', '');
  }
  const result: TestConnectionResult = failure || !text.trim()
    ? { ok: false, message: failure || 'The model answered with no text.' }
    : { ok: true, message: `It works. ${settings.model} answered: “${text.trim().slice(0, 300)}”` };
  res.json(result);
});
