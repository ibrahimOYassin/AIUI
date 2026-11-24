/**
 * A tiny stand-in for the outside world, so agent flows can be tested offline:
 *   POST /v1/chat/completions   OpenAI-compatible chat (asks for the first tool, then answers)
 *   POST /v1/messages           Anthropic Messages API (same behaviour)
 *   GET  /todos/:id             a JSON API for the tool to call
 *   POST /mcp                   an MCP server with one tool, "add"
 *   /bot<token>/...             Telegram Bot API: one waiting update, then sendMessage
 *   /channels/:id/messages      Discord: one new message from a person and one from a bot
 *   POST /:phoneId/messages     WhatsApp Cloud API send
 *   POST /teams-webhook         a Teams Workflows webhook
 *
 * Standalone: npx tsx test/mock-services.ts 4500
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Json = Record<string, any>;

function chatCompletion(body: Json): Json {
  const messages: Json[] = body.messages ?? [];
  const last = messages.at(-1) ?? {};
  let message: Json;
  if (last.role === 'tool') {
    message = { role: 'assistant', content: `The tool said: ${String(last.content).slice(0, 200)}` };
  } else if (body.tools?.length) {
    const tool = body.tools[0].function;
    const args = tool.name === 'add' ? { a: 2, b: 3 } : tool.parameters?.properties?.topic ? { topic: 'bees' } : { id: 3 };
    message = { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: tool.name, arguments: JSON.stringify(args) } }] };
  } else {
    message = { role: 'assistant', content: `echo: ${String(last.content)}` };
  }
  return { id: 'chatcmpl-mock', object: 'chat.completion', model: body.model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] };
}

function anthropicMessage(body: Json): Json {
  const messages: Json[] = body.messages ?? [];
  const last = messages.at(-1) ?? {};
  const toolResult = Array.isArray(last.content) ? last.content.find((b: Json) => b.type === 'tool_result') : undefined;
  let content: Json[];
  let stop = 'end_turn';
  if (toolResult) {
    const text = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
    content = [{ type: 'text', text: `The tool said: ${text.slice(0, 200)}` }];
  } else if (body.tools?.length) {
    const tool = body.tools[0];
    content = [{ type: 'tool_use', id: 'toolu_mock_1', name: tool.name, input: tool.name === 'add' ? { a: 2, b: 3 } : { id: 3 } }];
    stop = 'tool_use';
  } else {
    const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
    content = [{ type: 'text', text: `echo: ${text}` }];
  }
  return {
    id: 'msg_mock', type: 'message', role: 'assistant', model: body.model, content,
    stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function mcp(body: Json): Json | null {
  const reply = (result: Json) => ({ jsonrpc: '2.0', id: body.id, result });
  switch (body.method) {
    case 'initialize':
      return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock-mcp', version: '1.0' } });
    case 'tools/list':
      return reply({ tools: [{ name: 'add', description: 'Add two numbers.', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } }] });
    case 'tools/call':
      return reply({ content: [{ type: 'text', text: String(Number(body.params?.arguments?.a) + Number(body.params?.arguments?.b)) }] });
    default:
      return null; // notifications
  }
}

/** Telegram and Discord answers; each bot token or channel gets its new message once. */
function messagingState() {
  const telegramSent = new Set<string>();
  const discordStarted = new Set<string>();
  const discordSent = new Set<string>();
  return {
    telegram(token: string, method: string): Json | null {
      if (method === 'deleteWebhook') return { ok: true, result: true };
      if (method === 'getMe') return token === 'bad-token' ? null : { ok: true, result: { id: 1, is_bot: true, username: 'aiui_test_bot' } };
      if (method === 'getUpdates') {
        if (telegramSent.has(token)) return { ok: true, result: [] };
        telegramSent.add(token);
        return { ok: true, result: [{ update_id: 900, message: { message_id: 5, text: 'hello bot', chat: { id: 4242, type: 'private' }, from: { id: 7, first_name: 'Sam', last_name: 'Rivera' } } }] };
      }
      if (method === 'sendMessage') return { ok: true, result: { message_id: 77 } };
      return null;
    },
    discordList(channel: string): Json[] {
      if (!discordStarted.has(channel)) {
        discordStarted.add(channel);
        return [{ id: '100', content: 'an old message', author: { id: 'u0', username: 'old' } }];
      }
      if (discordSent.has(channel)) return [];
      discordSent.add(channel);
      // Newest first, as Discord sends them.
      return [
        { id: '102', content: 'bot talk', author: { id: 'b1', username: 'somebot', bot: true } },
        { id: '101', content: 'hi from discord', author: { id: 'u1', username: 'sam', global_name: 'Sam' } },
      ];
    },
  };
}

export interface MockRequest { method: string; path: string; body: Json; headers: http.IncomingHttpHeaders }

export function startMock(port = 0): Promise<{ url: string; requests: MockRequest[]; close: () => void }> {
  const requests: MockRequest[] = [];
  const messaging = messagingState();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      let body: Json = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { raw };
      }
      requests.push({ method: req.method ?? 'GET', path, body, headers: req.headers });
      const send = (status: number, payload: Json | null) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(payload ? JSON.stringify(payload) : '');
      };
      if (req.method === 'POST' && path.endsWith('/chat/completions')) return send(200, chatCompletion(body));
      if (req.method === 'POST' && path.endsWith('/v1/messages')) return send(200, anthropicMessage(body));
      if (req.method === 'POST' && path === '/mcp') {
        const result = mcp(body);
        return result ? send(200, result) : send(202, null);
      }
      const telegram = path.match(/^\/bot([^/]+)\/(\w+)$/);
      if (telegram) {
        const result = messaging.telegram(telegram[1]!, telegram[2]!);
        // getUpdates is a long poll: an empty answer comes back after a short wait.
        if (result && telegram[2] === 'getUpdates' && !result.result.length) return void setTimeout(() => send(200, result), 300);
        return result ? send(200, result) : send(404, { ok: false, description: 'Not Found' });
      }
      const discord = path.match(/^\/channels\/([^/]+)\/messages$/);
      if (discord && req.method === 'GET') return send(200, messaging.discordList(discord[1]!) as unknown as Json);
      if (discord && req.method === 'POST') return send(200, { id: `msg-${requests.length}`, channel_id: discord[1] });
      if (req.method === 'POST' && path === '/teams-webhook') return send(202, null);
      const whatsapp = path.match(/^\/([^/]+)\/messages$/);
      if (whatsapp && req.method === 'POST' && body.messaging_product === 'whatsapp')
        return send(200, { messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.${requests.length}` }] });
      const todo = path.match(/^\/todos\/(\d+)$/);
      if (todo) return send(200, { id: Number(todo[1]), title: 'mock todo', completed: true });
      send(404, { error: 'not found' });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${address.port}`, requests, close: () => server.close() });
    });
  });
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('test/mock-services.ts')) {
  const mock = await startMock(Number(process.argv[2] ?? 4500));
  console.log(`Mock services on ${mock.url}`);
}
