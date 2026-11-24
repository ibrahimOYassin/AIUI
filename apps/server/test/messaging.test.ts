/**
 * The Messaging Bridge plugin against stand-ins for Telegram, Discord, WhatsApp and Teams.
 * Runs the generated Python project: once (like the IDE), and as a long-running bot.
 */
import assert from 'node:assert/strict';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import type { ConnectionTypeDef, FlowNode, Graph, Language } from '@aiui/shared';
import { type MockRequest, startMock } from './mock-services.ts';

process.env.AIUI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aiui-test-data-'));
const { loadFirstPartyPlugins } = await import('../src/plugins.ts');
const { generate, plan, validate } = await import('../src/codegen/index.ts');
type BuildInput = import('../src/codegen/index.ts').BuildInput;
type NodeTypeEntry = import('../src/plugins.ts').NodeTypeEntry;

const python = process.env.AIUI_PYTHON ?? 'python';
const nodeTypes = new Map<string, NodeTypeEntry>();
const connectionTypes = new Map<string, ConnectionTypeDef>();
for (const { manifest } of loadFirstPartyPlugins()) {
  for (const def of manifest.nodes) nodeTypes.set(def.type, { def, pluginId: manifest.id, pluginName: manifest.name });
  for (const def of manifest.connectionTypes ?? []) connectionTypes.set(def.type, def);
}

let mock: Awaited<ReturnType<typeof startMock>>;
const children: ChildProcess[] = [];
before(async () => {
  mock = await startMock();
});
after(() => {
  for (const child of children) child.kill();
  mock.close();
});

type Conn = BuildInput['connections'][number];
// The language goes into the bot token and channel, so each run gets its own message from the mock.
let lang: Language = 'python';
const telegram = (): Conn => ({ id: 'tg', name: 'My Telegram', type: 'messaging_app', values: { service: 'telegram', apiBase: mock.url, defaultTo: '1001' }, secrets: { token: `TG-${lang}` } });
const discord = (): Conn => ({ id: 'dc', name: 'My Discord', type: 'messaging_app', values: { service: 'discord', apiBase: mock.url, channelId: `C-${lang}` }, secrets: { token: 'DC-TOKEN' } });
const whatsapp = (secret = 'wa-app-secret'): Conn => ({
  id: 'wa', name: 'My WhatsApp', type: 'messaging_app',
  values: { service: 'whatsapp', apiBase: mock.url, phoneNumberId: 'PN1', verifyToken: 'let-me-in' },
  secrets: { accessToken: 'WA-TOKEN', appSecret: secret },
});
const teams = (): Conn => ({ id: 'ms', name: 'My Teams', type: 'messaging_app', values: { service: 'teams' }, secrets: { webhookUrl: `${mock.url}/teams-webhook`, teamsToken: Buffer.from('teams-key').toString('base64') } });

const node = (id: string, type: string, name: string, config: Record<string, unknown>): FlowNode => ({ id, type, name, position: { x: 0, y: 0 }, config });
const chain = (...nodes: FlowNode[]): Graph => ({
  nodes, edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i]!.id, sourcePort: 'out', target: n.id })),
});

function build(graph: Graph, connections: Conn[]): BuildInput {
  return {
    project: { id: 'p1', name: 'Bot', description: '', type: 'agent', graph, settings: { defaultLanguage: 'python' }, createdAt: '', updatedAt: '' },
    nodeTypes, connectionTypes, connections,
  };
}

function write(input: BuildInput, language: Language = 'python'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aiui-msg-${language}-`));
  for (const file of generate(input, language)) {
    fs.mkdirSync(path.dirname(path.join(dir, file.path)), { recursive: true });
    fs.writeFileSync(path.join(dir, file.path), file.content);
  }
  return dir;
}

const env = (input: BuildInput) => ({ ...process.env, ...plan(input).secretEnv, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' });

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor<T>(what: string, check: () => T | undefined | false, ms = 15000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Writes the project and, for C#, builds it once. Returns how to start it. */
function prepare(input: BuildInput, language: Language): { cmd: string; args: string[]; cwd: string } {
  const cwd = write(input, language);
  if (language === 'python') return { cmd: python, args: ['main.py'], cwd };
  const built = spawnSync('dotnet', ['build', '-o', 'out', '--nologo', '-v', 'q'], { cwd, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  // Run the built program directly: killing "dotnet run" would leave the program itself running.
  return { cmd: 'dotnet', args: [path.join('out', 'Bot.dll')], cwd };
}

/** Runs the project once, like Run in the IDE. Asynchronous, because the mock services live in this process. */
function runOnce(input: BuildInput, language: Language, ...extra: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const { cmd, args, cwd } = prepare(input, language);
  return new Promise((resolve) => {
    const child = spawn(cmd, [...args, '--once', ...extra], { cwd, env: env(input) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** Starts the exported project the way a user would (no --once) and collects its output. */
function startBot(input: BuildInput, language: Language) {
  const { cmd, args, cwd } = prepare(input, language);
  const child = spawn(cmd, args, { cwd, env: env(input) });
  children.push(child);
  const output = { text: '' };
  child.stdout.on('data', (d) => (output.text += d));
  child.stderr.on('data', (d) => (output.text += d));
  return { child, output };
}

/** Requests made since the current test started. */
let mark = 0;
const sent = (pathPart: string) => () => mock.requests.slice(mark).filter((r: MockRequest) => r.method === 'POST' && r.path.includes(pathPart));

test('messaging: the plugin validates and only asks for the secrets each app uses', () => {
  const graph = chain(node('t1', 'messaging.receive', 'incoming', { connection: 'tg' }), node('s1', 'messaging.send', 'reply', { connection: 'tg', message: 'Hi {{incoming.senderName}}' }));
  assert.deepEqual(validate(build(graph, [telegram()])), []);
  const example = generate(build(graph, [telegram()]), 'python').find((f) => f.path === '.env.example')!.content;
  assert.match(example, /AIUI_MY_TELEGRAM_TOKEN=/);
  assert.doesNotMatch(example, /ACCESS_TOKEN|TEAMS_TOKEN|WEBHOOK_URL|APP_SECRET/);
  for (const language of ['python', 'csharp'] as Language[])
    assert.ok(!generate(build(graph, [telegram()]), language).some((f) => f.content.includes('TG-python')), `${language} leaked the token`); // lang is still 'python' here
});

// C# builds are slow, so they run only with AIUI_TEST_DOTNET=1, like the other C# test.
for (const language of ['python', 'csharp'] as Language[]) {
  const opts = { skip: language === 'csharp' && process.env.AIUI_TEST_DOTNET !== '1', timeout: 180_000 };

  test(`messaging (${language}): Send a message reaches all four apps, splitting long text`, opts, async () => {
    lang = language;
    mark = mock.requests.length;
    const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' '); // about 2,300 characters
    const graph = chain(
      node('t1', 'trigger.manual', 'start', {}),
      node('a', 'messaging.send', 'to_telegram', { connection: 'tg', message: 'hello telegram', to: '42' }),
      node('b', 'messaging.send', 'to_discord', { connection: 'dc', message: long }),
      node('c', 'messaging.send', 'to_whatsapp', { connection: 'wa', message: 'hello whatsapp', to: '+1 555 0100' }),
      node('d', 'messaging.send', 'to_teams', { connection: 'ms', message: 'hello **teams**' }),
    );
    const input = build(graph, [telegram(), discord(), whatsapp(), teams()]);
    const before = mock.requests.length;
    const result = await runOnce(input, language);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const calls = mock.requests.slice(before);

    const tg = calls.find((r) => r.path === `/botTG-${lang}/sendMessage`)!;
    assert.deepEqual(tg.body, { chat_id: '42', text: 'hello telegram' });

    const dc = calls.filter((r) => r.method === 'POST' && r.path === `/channels/C-${lang}/messages`);
    assert.equal(dc.length, 2, 'Discord text over 2,000 characters is sent in two parts');
    assert.ok(dc.every((r) => r.headers.authorization === 'Bot DC-TOKEN' && String(r.body.content).length <= 2000));
    assert.equal(dc.map((r) => r.body.content).join(' '), long);

    const wa = calls.find((r) => r.path === '/PN1/messages')!;
    assert.equal(wa.headers.authorization, 'Bearer WA-TOKEN');
    assert.deepEqual(wa.body, { messaging_product: 'whatsapp', recipient_type: 'individual', to: '15550100', type: 'text', text: { body: 'hello whatsapp' } });

    const ms = calls.find((r) => r.path === '/teams-webhook')!;
    assert.equal(ms.body.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
    assert.equal(ms.body.attachments[0].content.body[0].text, 'hello **teams**');
  });

  test(`messaging (${language}): Run in the IDE uses the test message and the default recipient`, opts, async () => {
    lang = language;
    mark = mock.requests.length;
    const graph = chain(
      node('t1', 'messaging.receive', 'incoming', { connection: 'tg', sampleText: 'ping' }),
      node('s1', 'messaging.send', 'reply', { connection: 'tg', message: 'pong to {{incoming.text}}' }),
    );
    const input = build(graph, [telegram()]);
    const before = mock.requests.length;
    const result = await runOnce(input, language, '--events');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const call = mock.requests.slice(before).find((r) => r.path.endsWith('/sendMessage'))!;
    assert.deepEqual(call.body, { chat_id: '1001', text: 'pong to ping' });
  });

  test(`messaging (${language}): a Telegram bot answers in the chat the message came from`, opts, async () => {
    lang = language;
    mark = mock.requests.length;
    const graph = chain(
      node('t1', 'messaging.receive', 'incoming', { connection: 'tg' }),
      node('s1', 'messaging.send', 'reply', { connection: 'tg', message: '{{input.senderName}} said: {{input.text}}' }),
    );
    const { child, output } = startBot(build(graph, [telegram()]), language);
    const call = await waitFor('the Telegram reply', () => sent('/sendMessage')().find((r) => r.body.chat_id === '4242'));
    child.kill();
    assert.equal(call.body.text, 'Sam Rivera said: hello bot', output.text);
    assert.match(output.text, /Waiting for Telegram messages/);
  });

  test(`messaging (${language}): Discord messages are forwarded to Telegram, but bots and old messages are not`, opts, async () => {
    lang = language;
    mark = mock.requests.length;
    const graph = chain(
      node('t1', 'messaging.receive', 'incoming', { connection: 'dc', pollSeconds: 1 }),
      node('s1', 'messaging.send', 'forward', { connection: 'tg', message: '{{incoming.senderName}} on {{incoming.platform}}: {{incoming.text}}', to: '555' }),
    );
    const { child, output } = startBot(build(graph, [discord(), telegram()]), language);
    await waitFor('the forwarded message', () => sent('/sendMessage')().find((r) => r.body.chat_id === '555'));
    await new Promise((r) => setTimeout(r, 1500)); // one more polling round
    child.kill();
    const forwarded = sent('/sendMessage')().filter((r) => r.body.chat_id === '555').map((r) => r.body.text);
    assert.deepEqual(forwarded, ['Sam on discord: hi from discord'], output.text);
  });

  test(`messaging (${language}): WhatsApp webhook confirms the address, checks signatures and replies`, opts, async () => {
    lang = language;
    mark = mock.requests.length;
    const port = await freePort();
    const graph = chain(
      node('t1', 'messaging.receive', 'incoming', { connection: 'wa', port, path: '/wa' }),
      node('s1', 'messaging.send', 'reply', { connection: 'wa', message: 'Thanks {{incoming.senderName}}, you said "{{incoming.text}}"' }),
    );
    const { child, output } = startBot(build(graph, [whatsapp()]), language);
    await waitFor('the server to start', () => output.text.includes('Listening for WhatsApp'));
    const base = `http://127.0.0.1:${port}/wa`;

    const ok = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=let-me-in&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '12345');
    assert.equal((await fetch(`${base}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status, 403);

    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        contacts: [{ wa_id: '15550111', profile: { name: 'Lee' } }],
        messages: [{ from: '15550111', id: 'wamid.in', type: 'text', text: { body: 'hola' } }],
      } }] }],
    });
    const unsigned = await fetch(base, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    assert.equal(unsigned.status, 401);
    const signature = 'sha256=' + crypto.createHmac('sha256', 'wa-app-secret').update(body).digest('hex');
    const signed = await fetch(base, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature } });
    assert.equal(signed.status, 200);

    const reply = await waitFor('the WhatsApp reply', () => sent('/PN1/messages')().find((r) => r.body.to === '15550111'));
    child.kill();
    assert.equal(reply.body.text.body, 'Thanks Lee, you said "hola"', output.text);
  });

  test(`messaging (${language}): Teams outgoing webhook is verified, answered at once, then replied to`, opts, async () => {
    lang = language;
    mark = mock.requests.length;
    const port = await freePort();
    const graph = chain(
      node('t1', 'messaging.receive', 'incoming', { connection: 'ms', port, teamsReply: 'One moment…' }),
      node('s1', 'messaging.send', 'reply', { connection: 'ms', message: 'Echo: {{incoming.text}}' }),
    );
    const { child, output } = startBot(build(graph, [teams()]), language);
    await waitFor('the server to start', () => output.text.includes('Listening for Microsoft Teams'));
    const body = JSON.stringify({
      type: 'message', id: 'act1', text: '<at>Helper</at> what&#39;s the <b>status</b>?',
      from: { id: 'user-1', name: 'Kim' }, conversation: { id: 'conv-1' },
    });
    const url = `http://127.0.0.1:${port}/messages`;
    assert.equal((await fetch(url, { method: 'POST', body, headers: { Authorization: 'HMAC bm9wZQ==' } })).status, 401);
    const hmac = crypto.createHmac('sha256', Buffer.from('teams-key')).update(body).digest('base64');
    const answer = await fetch(url, { method: 'POST', body, headers: { Authorization: `HMAC ${hmac}`, 'Content-Type': 'application/json' } });
    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { type: 'message', text: 'One moment…' });

    const reply = await waitFor('the Teams reply', () => sent('/teams-webhook')().find((r) => String(r.body.attachments?.[0]?.content?.body?.[0]?.text).startsWith('Echo:')));
    child.kill();
    assert.equal(reply.body.attachments[0].content.body[0].text, "Echo: what's the status ?", output.text);
  });
}
