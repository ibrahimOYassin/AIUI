/**
 * A tiny stand-in for the outside world, so agent flows can be tested offline:
 *   POST /v1/chat/completions   OpenAI-compatible chat (asks for the first tool, then answers)
 *   POST /v1/messages           Anthropic Messages API (same behaviour)
 *   GET  /todos/:id             a JSON API for the tool to call
 *   POST /mcp                   an MCP server with one tool, "add"
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

export function startMock(port = 0): Promise<{ url: string; requests: { path: string; body: Json }[]; close: () => void }> {
  const requests: { path: string; body: Json }[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      const body: Json = raw ? JSON.parse(raw) : {};
      requests.push({ path, body });
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
