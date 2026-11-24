/**
 * Starts the real server (web mode, temporary database) and exercises it over HTTP:
 * accounts and isolation, projects, connections vault, generate/export/run, agents with
 * tools against mock LLM/MCP services, marketplace purchases and the developer portal.
 *
 * Set AIUI_TEST_PYTHON_ANTHROPIC to a Python that has the `anthropic` package to also
 * run the Claude SDK path against the mock.
 */
import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import type {
  ActivityPage, AdminPlugin, AdminUser, AdminUserDetail, MeResponse, PlatformSettings, ReportOverview,
  AuthResponse, Catalog, Connection, DevListing, Earnings, GenerateResponse, Graph, Issue, Listing, ListingDetail,
  PluginManifest, Project, RunEvent,
} from '@aiui/shared';
import { startMock } from './mock-services.ts';

const PORT = 4390 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}/api`;
const serverDir = path.resolve(import.meta.dirname, '..');
const claudePython = process.env.AIUI_TEST_PYTHON_ANTHROPIC;
const ADMIN = { email: 'root@example.com', password: 'seeded-admin-pass' };
let server: ChildProcess;
let mock: Awaited<ReturnType<typeof startMock>>;

async function api<T>(method: string, route: string, token?: string, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await fetch(BASE + route, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* binary or empty */ }
  return { status: response.status, data: data as T };
}

async function run(token: string, projectId: string, input: unknown = {}): Promise<RunEvent[]> {
  const response = await fetch(`${BASE}/projects/${projectId}/run`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ input }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as RunEvent);
}

const endOf = (events: RunEvent[]) => events.at(-1) as Extract<RunEvent, { type: 'run_end' }>;

before(async () => {
  mock = await startMock();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiui-api-test-'));
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: {
      ...process.env, PORT: String(PORT), AIUI_MODE: 'web', AIUI_ALLOW_RUN: 'true', AIUI_DATA_DIR: dataDir,
      AIUI_ADMIN_EMAIL: ADMIN.email, AIUI_ADMIN_PASSWORD: ADMIN.password, AIUI_CORS_ORIGINS: 'https://app.example.com',
      ...(claudePython ? { AIUI_PYTHON: claudePython } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout!.on('data', (chunk) => (log += chunk));
  server.stderr!.on('data', (chunk) => (log += chunk));
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${BASE}/config`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server did not start:\n${log}`);
});

after(() => {
  server?.kill();
  mock?.close();
});

let alice: AuthResponse;
let bob: AuthResponse;

test('accounts: register, sign in, and no auto sign-in in web mode', async () => {
  assert.deepEqual((await api('GET', '/config')).data, { mode: 'web', version: '0.1.0', allowRun: true, allowRegistration: true });
  assert.equal((await api('POST', '/auth/local')).status, 403);
  assert.equal((await api('GET', '/projects')).status, 401);
  assert.equal((await api('POST', '/auth/register', undefined, { email: 'a@x.io', name: 'Alice', password: 'short' })).status, 400);

  const created = await api<AuthResponse>('POST', '/auth/register', undefined, { email: 'alice@example.com', name: 'Alice', password: 'correct-horse' });
  assert.equal(created.status, 201);
  alice = created.data;
  assert.deepEqual(alice.user.roles, ['user'], 'registering never grants admin');
  assert.equal(alice.user.status, 'active');
  assert.equal(alice.user.canRun, true);
  bob = (await api<AuthResponse>('POST', '/auth/register', undefined, { email: 'bob@example.com', name: 'Bob', password: 'battery-staple' })).data;
  assert.deepEqual(bob.user.roles, ['user']);

  assert.equal((await api('POST', '/auth/register', undefined, { email: 'alice@example.com', name: 'A', password: 'correct-horse' })).status, 409);
  assert.equal((await api('POST', '/auth/login', undefined, { email: 'alice@example.com', password: 'wrong' })).status, 401);
  assert.equal((await api<AuthResponse>('POST', '/auth/login', undefined, { email: 'alice@example.com', password: 'correct-horse' })).data.user.id, alice.user.id);
  assert.equal((await api('GET', '/auth/me', 'forged.token')).status, 401);
});

test('accounts: a new account sees the welcome tips until it closes them', async () => {
  assert.equal(alice.user.tipsSeenAt, null, 'new accounts have not seen the tips');
  const closed = await api<{ user: AuthResponse['user'] }>('PATCH', '/auth/me', alice.token, { tipsSeen: true });
  assert.equal(closed.status, 200);
  assert.ok(closed.data.user.tipsSeenAt, 'closing the tips is remembered');
  assert.ok((await api<MeResponse>('GET', '/auth/me', alice.token)).data.user.tipsSeenAt, 'and still remembered next time');
  const reopened = await api<{ user: AuthResponse['user'] }>('PATCH', '/auth/me', alice.token, { tipsSeen: false });
  assert.equal(reopened.data.user.tipsSeenAt, null);
});

test('catalog: core plugins are present, marketplace plugins are not until installed', async () => {
  const { data } = await api<Catalog>('GET', '/catalog', alice.token);
  const types = data.nodeTypes.map((n) => n.type);
  assert.ok(types.includes('trigger.manual') && types.includes('ai.agent') && types.includes('http.request'));
  assert.ok(!types.includes('email.send'));
  assert.ok(!JSON.stringify(data).includes('def run('), 'step source must not reach the browser');
  assert.ok(data.templates.length >= 4);
});

let projectId: string;

test('projects: create from template, update, isolation between users', async () => {
  const created = await api<Project>('POST', '/projects', alice.token, { name: 'Orders Digest', type: 'workflow', templateId: 'aiui.ai.fetch-and-loop' });
  assert.equal(created.status, 201);
  projectId = created.data.id;
  assert.equal(created.data.graph.nodes.length, 5);

  assert.equal((await api('GET', `/projects/${projectId}`, bob.token)).status, 404);
  assert.equal((await api('PUT', `/projects/${projectId}`, bob.token, { name: 'stolen' })).status, 404);
  assert.equal((await api<unknown[]>('GET', '/projects', bob.token)).data.length, 0);

  const graph: Graph = {
    nodes: [
      { id: 't1', type: 'trigger.manual', name: 'start', position: { x: 0, y: 0 }, config: { sampleInput: { items: ['a', 'b'] } } },
      { id: 'l1', type: 'logic.loop', name: 'each', position: { x: 200, y: 0 }, config: { items: '{{input.items}}' } },
      { id: 'g1', type: 'util.log', name: 'say', position: { x: 400, y: 0 }, config: { message: 'item {{item}}' } },
    ],
    edges: [
      { id: 'e1', source: 't1', sourcePort: 'out', target: 'l1' },
      { id: 'e2', source: 'l1', sourcePort: 'item', target: 'g1' },
      { id: 'bad', source: 't1', sourcePort: 'out', target: 'does-not-exist' },
    ],
  };
  const saved = await api<Project>('PUT', `/projects/${projectId}`, alice.token, { graph });
  assert.equal(saved.data.graph.edges.length, 2, 'dangling links are dropped');
  assert.deepEqual((await api<{ issues: Issue[] }>('POST', `/projects/${projectId}/validate`, alice.token)).data.issues, []);
});

test('build: generate both languages, export a zip, run with live events', async () => {
  for (const language of ['python', 'csharp']) {
    const { data } = await api<GenerateResponse>('POST', `/projects/${projectId}/generate`, alice.token, { language });
    assert.ok(data.files.some((f) => f.path === (language === 'python' ? 'workflow.py' : 'Workflow.cs')));
  }
  const zip = await fetch(`${BASE}/projects/${projectId}/export?language=csharp`, { headers: { Authorization: `Bearer ${alice.token}` } });
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.match(zip.headers.get('content-disposition') ?? '', /OrdersDigest-csharp\.zip/);
  assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString(), 'PK');

  const events = await run(alice.token, projectId);
  assert.equal(events[0]!.type, 'run_start');
  assert.deepEqual(events.filter((e) => e.type === 'log').map((e) => (e as { message: string }).message), ['item a', 'item b']);
  assert.equal(endOf(events).status, 'success');

  const custom = await run(alice.token, projectId, { items: ['z'] });
  assert.deepEqual(custom.filter((e) => e.type === 'log').map((e) => (e as { message: string }).message), ['item z']);
});

test('connections: secrets are stored encrypted, never returned, and kept on edit', async () => {
  const created = await api<Connection>('POST', '/connections', alice.token, {
    name: 'Mock LLM', type: 'llm', values: { provider: 'openai', baseUrl: `${mock.url}/v1`, apiKey: 'sk-top-secret', model: 'mock-model' },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.secretsSet, ['apiKey']);
  assert.ok(!JSON.stringify(created.data).includes('sk-top-secret'));
  assert.equal((await api<Connection[]>('GET', '/connections', bob.token)).data.length, 0);
  assert.equal((await api('PUT', `/connections/${created.data.id}`, bob.token, { name: 'x', values: {} })).status, 404);

  const renamed = await api<Connection>('PUT', `/connections/${created.data.id}`, alice.token, { name: 'Mock LLM 2', type: 'llm', values: { ...created.data.values } });
  assert.equal(renamed.data.name, 'Mock LLM 2');
  assert.deepEqual(renamed.data.secretsSet, ['apiKey'], 'an omitted secret keeps the stored value');
  assert.equal((await api('POST', '/connections', alice.token, { name: 'x', type: 'smtp', values: {} })).status, 400, 'type from a plugin that is not installed');
});

async function agentProject(provider: 'openai' | 'anthropic'): Promise<{ id: string; events: RunEvent[] }> {
  const connection = (await api<Connection>('POST', '/connections', alice.token, {
    name: `Agent model ${provider}`, type: 'llm',
    values: { provider, baseUrl: provider === 'openai' ? `${mock.url}/v1` : mock.url, apiKey: 'sk-agent-secret', model: 'mock-model' },
  })).data;
  const project = (await api<Project>('POST', '/projects', alice.token, { name: `Agent ${provider}`, type: 'agent', templateId: 'aiui.ai.support-agent' })).data;
  const graph = project.graph;
  for (const node of graph.nodes) {
    if (node.type === 'ai.agent') node.config.connection = connection.id;
    if (node.type === 'http.request') node.config.url = `${mock.url}/todos/{{args.id}}`;
  }
  await api('PUT', `/projects/${project.id}`, alice.token, { graph });
  return { id: project.id, events: await run(alice.token, project.id, { message: 'What is todo 3?', history: [] }) };
}

test('agent: the model calls a linked step as a tool (OpenAI-compatible endpoint)', async () => {
  const { id, events } = await agentProject('openai');
  const end = endOf(events);
  assert.equal(end.status, 'success', JSON.stringify(events));
  assert.match((end.output as { text: string }).text, /mock todo/);
  assert.ok(events.some((e) => e.type === 'node_end' && e.name === 'lookup_todo'), 'the tool step ran');
  const call = mock.requests.find((r) => r.path.endsWith('/chat/completions'))!;
  assert.equal(call.body.tools[0].function.name, 'lookup_todo');
  assert.deepEqual(call.body.tools[0].function.parameters.required, ['id']);

  const python = (await api<GenerateResponse>('POST', `/projects/${id}/generate`, alice.token, { language: 'python' })).data;
  assert.ok(!python.files.some((f) => f.content.includes('sk-agent-secret')));
});

test('agent: Claude through the Anthropic SDK', { skip: !claudePython && 'set AIUI_TEST_PYTHON_ANTHROPIC' }, async () => {
  const { events } = await agentProject('anthropic');
  const end = endOf(events);
  assert.equal(end.status, 'success', JSON.stringify(events));
  assert.match((end.output as { text: string }).text, /mock todo/);
  const call = mock.requests.find((r) => r.path.endsWith('/v1/messages'))!;
  assert.equal(call.body.tools[0].name, 'lookup_todo');
  assert.equal(call.body.temperature, undefined, 'sampling parameters are not sent to Claude');
});

test('marketplace: free install, paid purchase, reviews', async () => {
  const listings = (await api<Listing[]>('GET', '/market/plugins', bob.token)).data;
  assert.ok(listings.length >= 9);
  const paid = (await api<Listing[]>('GET', '/market/plugins?price=paid', bob.token)).data;
  assert.deepEqual(paid.map((l) => l.id), ['aiui.reports']);
  assert.equal((await api<Listing[]>('GET', '/market/plugins?q=smtp', bob.token)).data[0]!.id, 'aiui.email');

  assert.equal((await api('POST', '/market/plugins/aiui.email/install', bob.token)).status, 200);
  const catalog = (await api<Catalog>('GET', '/catalog', bob.token)).data;
  assert.ok(catalog.nodeTypes.some((n) => n.type === 'email.send'));
  assert.ok(catalog.connectionTypes.some((c) => c.type === 'smtp'));

  assert.equal((await api('POST', '/market/plugins/aiui.reports/install', bob.token)).status, 402, 'paid plugins need a purchase');
  assert.equal((await api('POST', '/market/plugins/aiui.reports/purchase', bob.token)).status, 200);
  assert.equal((await api('POST', '/market/plugins/aiui.reports/install', bob.token)).status, 200);

  assert.equal((await api('POST', '/market/plugins/aiui.email/reviews', alice.token, { rating: 5 })).status, 400, 'must be installed');
  assert.equal((await api('POST', '/market/plugins/aiui.email/reviews', bob.token, { rating: 4, comment: 'Works well.' })).status, 200);
  const detail = (await api<ListingDetail>('GET', '/market/plugins/aiui.email', bob.token)).data;
  assert.equal(detail.rating, 4);
  assert.equal(detail.downloads, 1);
  assert.ok(detail.installed && detail.reviews[0]!.mine);
  assert.ok(!JSON.stringify(detail).includes('smtplib'), 'listing pages do not expose step source');

  await api('PATCH', '/market/installed/aiui.email', bob.token, { enabled: false });
  assert.ok(!(await api<Catalog>('GET', '/catalog', bob.token)).data.nodeTypes.some((n) => n.type === 'email.send'));
  assert.equal((await api('DELETE', '/market/plugins/aiui.core/install', bob.token)).status, 400);
});

const manifest: PluginManifest = {
  id: 'alice.shout', name: 'Shout', version: '1.0.0', description: 'Turns text into capital letters.',
  author: 'Alice Labs', icon: 'megaphone', category: 'Data',
  nodes: [{
    type: 'shout.upper', label: 'Shout', description: 'Make text upper case.', kind: 'action', category: 'Data', icon: 'megaphone',
    inputs: [{ id: 'in', label: 'In' }], outputs: [{ id: 'out', label: 'Next' }],
    fields: [{ key: 'text', label: 'Text', type: 'text', templated: true, required: true }],
    outputFields: [{ key: 'text', label: 'Text' }],
    codegen: {
      python: { source: 'def run(cfg, ctx):\n    return {"text": str(cfg.get("text") or "").upper()}\n' },
      csharp: {
        className: 'ShoutUpperStep',
        source: 'using System.Text.Json.Nodes;\nusing Aiui.Runtime;\n\nnamespace Aiui.Steps;\n\npublic static class ShoutUpperStep\n{\n    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx) =>\n        Task.FromResult<JsonNode?>(new JsonObject { ["text"] = J.Text(cfg["text"]).ToUpperInvariant() });\n}\n',
      },
    },
  }],
};

test('developer portal: validate, publish a paid plugin, sell it, run its step', async () => {
  assert.equal((await api('GET', '/dev/plugins', alice.token)).status, 403);
  const upgraded = await api<{ user: AuthResponse['user'] }>('PATCH', '/auth/me', alice.token, { becomeDeveloper: true, developerName: 'Alice Labs' });
  assert.ok(upgraded.data.user.roles.includes('developer'));

  const broken = { ...manifest, version: 'one', nodes: [{ ...manifest.nodes[0]!, type: 'http.request' }] };
  assert.equal((await api<{ ok: boolean }>('POST', '/dev/validate', alice.token, { manifest: broken })).data.ok, false);
  const clash = { ...manifest, nodes: [{ ...manifest.nodes[0]!, type: 'http.request' }] };
  const clashResult = (await api<{ ok: boolean; errors: string[] }>('POST', '/dev/validate', alice.token, { manifest: clash })).data;
  assert.ok(!clashResult.ok && clashResult.errors[0]!.includes('already provided'));
  assert.equal((await api('POST', '/dev/plugins', alice.token, { manifest: { ...manifest, id: 'aiui.fake' } })).status, 400);

  const draft = await api<DevListing>('POST', '/dev/plugins', alice.token, { manifest, summary: 'Upper-case anything.', priceCents: 500, tags: ['text'] });
  assert.equal(draft.status, 201);
  assert.equal(draft.data.status, 'draft');
  assert.equal((await api('GET', '/market/plugins/alice.shout', bob.token)).status, 404, 'drafts are private');

  await api('POST', '/dev/plugins/alice.shout/publish', alice.token);
  assert.equal((await api('PUT', '/dev/plugins/alice.shout', bob.token, { priceCents: 0 })).status, 403);
  const listing = (await api<ListingDetail>('GET', '/market/plugins/alice.shout', bob.token)).data;
  assert.equal(listing.priceCents, 500);
  assert.equal(listing.author.name, 'Alice Labs');
  assert.equal(listing.owned, false);

  await api('POST', '/market/plugins/alice.shout/purchase', bob.token);
  await api('POST', '/market/plugins/alice.shout/install', bob.token);
  const earnings = (await api<Earnings>('GET', '/dev/earnings', alice.token)).data;
  assert.equal(earnings.salesCount, 1);
  assert.equal(earnings.totalCents, 400, 'developer keeps 80%');
  assert.equal((await api('DELETE', '/dev/plugins/alice.shout', alice.token)).status, 409, 'sold plugins cannot be deleted');

  // Bob uses the third-party step in a project and runs it.
  const project = (await api<Project>('POST', '/projects', bob.token, { name: 'Loud', type: 'workflow' })).data;
  await api('PUT', `/projects/${project.id}`, bob.token, {
    graph: {
      nodes: [
        { id: 't', type: 'trigger.manual', name: 'start', position: { x: 0, y: 0 }, config: { sampleInput: { word: 'hello' } } },
        { id: 's', type: 'shout.upper', name: 'shout', position: { x: 200, y: 0 }, config: { text: '{{input.word}}!' } },
      ],
      edges: [{ id: 'e', source: 't', sourcePort: 'out', target: 's' }],
    },
  });
  assert.deepEqual(endOf(await run(bob.token, project.id)).output, { text: 'HELLO!' });

  // A new version reaches users only when they update.
  const v2 = { ...manifest, version: '1.1.0' };
  assert.equal((await api('PUT', '/dev/plugins/alice.shout', alice.token, { manifest: { ...manifest, version: '0.9.0' } })).status, 400);
  assert.equal((await api<DevListing>('PUT', '/dev/plugins/alice.shout', alice.token, { manifest: v2, changelog: 'Faster.' })).data.version, '1.1.0');
  const installed = (await api<Catalog>('GET', '/catalog', bob.token)).data.plugins.find((p) => p.id === 'alice.shout')!;
  assert.equal(installed.version, '1.0.0');
  assert.equal(installed.latestVersion, '1.1.0');

  // Uninstalling keeps the project; validation explains what is missing.
  await api('DELETE', '/market/plugins/alice.shout/install', bob.token);
  const issues = (await api<{ issues: Issue[] }>('POST', `/projects/${project.id}/validate`, bob.token)).data.issues;
  assert.ok(issues.some((i) => i.severity === 'error' && i.message.includes('not installed')));
  assert.equal((await api('POST', `/projects/${project.id}/run`, bob.token, {})).status, 400);
});

// ───────────────────────────── Administration ─────────────────────────────

let admin: AuthResponse;

test('admin: the seeded administrator can sign in; nobody else reaches the admin area', async () => {
  const signedIn = await api<AuthResponse>('POST', '/auth/login', undefined, ADMIN);
  assert.equal(signedIn.status, 200);
  admin = signedIn.data;
  assert.deepEqual(admin.user.roles, ['user', 'admin']);
  assert.equal((await api('GET', '/admin/users', alice.token)).status, 403);
  assert.equal((await api('GET', '/admin/users')).status, 401);
  assert.equal((await api('GET', '/admin/reports/overview', bob.token)).status, 403);

  const users = (await api<AdminUser[]>('GET', '/admin/users', admin.token)).data;
  assert.deepEqual(users.map((u) => u.email).sort(), ['alice@example.com', 'bob@example.com', 'root@example.com']);
  const aliceRow = users.find((u) => u.email === 'alice@example.com')!;
  assert.ok(aliceRow.projectCount >= 3 && aliceRow.runCount >= 3 && aliceRow.exportCount === 1 && aliceRow.loginCount === 1);
  assert.ok(aliceRow.lastSeenAt);
  assert.equal((await api<AdminUser[]>('GET', '/admin/users?q=bob', admin.token)).data.length, 1);
  assert.equal((await api<AdminUser[]>('GET', '/admin/users?role=developer', admin.token)).data[0]!.email, 'alice@example.com');
});

test('admin: deactivate and reactivate an account', async () => {
  const bobId = bob.user.id;
  assert.equal((await api<AdminUser>('PATCH', `/admin/users/${bobId}`, admin.token, { status: 'disabled' })).data.status, 'disabled');
  assert.equal((await api('GET', '/projects', bob.token)).status, 401, 'existing sessions stop working');
  const login = await api<{ error: string }>('POST', '/auth/login', undefined, { email: 'bob@example.com', password: 'battery-staple' });
  assert.equal(login.status, 403);
  assert.match(login.data.error, /deactivated/);
  assert.equal((await api('POST', `/admin/users/${bobId}/impersonate`, admin.token)).status, 400);
  assert.equal((await api<AdminUser[]>('GET', '/admin/users?status=disabled', admin.token)).data.length, 1);

  await api('PATCH', `/admin/users/${bobId}`, admin.token, { status: 'active' });
  assert.equal((await api('GET', '/projects', bob.token)).status, 200);

  assert.equal((await api('PATCH', `/admin/users/${admin.user.id}`, admin.token, { status: 'disabled' })).status, 400, 'not yourself');
  assert.equal((await api('PATCH', `/admin/users/${admin.user.id}`, admin.token, { roles: ['user'] })).status, 400, 'not your own admin role');
  assert.equal((await api('DELETE', `/admin/users/${admin.user.id}`, admin.token)).status, 400);
  assert.equal((await api('GET', '/admin/users/system', admin.token)).status, 404, 'the internal publisher is not a managed user');
});

test('admin: sign in as a user, with everything attributed', async () => {
  const session = await api<AuthResponse>('POST', `/admin/users/${bob.user.id}/impersonate`, admin.token);
  assert.equal(session.status, 200);
  const me = (await api<MeResponse>('GET', '/auth/me', session.data.token)).data;
  assert.equal(me.user.email, 'bob@example.com');
  assert.deepEqual(me.impersonator, { id: admin.user.id, name: 'Administrator' });
  assert.equal((await api<MeResponse>('GET', '/auth/me', bob.token)).data.impersonator, null);

  assert.equal((await api('GET', '/admin/users', session.data.token)).status, 403, 'no admin powers while impersonating');
  await api('PATCH', '/auth/me', session.data.token, { tipsSeen: true });
  assert.equal((await api<MeResponse>('GET', '/auth/me', bob.token)).data.user.tipsSeenAt, null, 'an admin looking around does not use up the tips');
  assert.equal((await api('POST', '/auth/password', session.data.token, { currentPassword: 'x', newPassword: 'whatever-123' })).status, 403);
  const created = await api<Project>('POST', '/projects', session.data.token, { name: 'Made by support', type: 'workflow' });
  assert.equal(created.status, 201);
  assert.ok((await api<{ id: string }[]>('GET', '/projects', bob.token)).data.some((p) => p.id === created.data.id), 'it is really Bob\'s project');

  const activity = (await api<ActivityPage>('GET', `/admin/reports/activity?userId=${bob.user.id}&type=project`, admin.token)).data;
  const event = activity.events.find((e) => e.summary.includes('Made by support'))!;
  assert.equal(event.user?.email, 'bob@example.com');
  assert.equal(event.impersonator?.id, admin.user.id);
  const adminLog = (await api<ActivityPage>('GET', '/admin/reports/activity?type=admin', admin.token)).data;
  assert.ok(adminLog.events.some((e) => e.type === 'admin.user.impersonate' && e.summary.includes('bob@example.com')));

  // Another admin cannot be impersonated; and the session ends when the admin loses the role.
  const second = (await api<AdminUser>('POST', '/admin/users', admin.token, { email: 'second@example.com', name: 'Second', password: 'second-admin-pw', roles: ['admin'] })).data;
  assert.deepEqual(second.roles, ['user', 'admin']);
  assert.equal((await api('POST', `/admin/users/${second.id}/impersonate`, admin.token)).status, 400);
  const secondSession = (await api<AuthResponse>('POST', '/auth/login', undefined, { email: 'second@example.com', password: 'second-admin-pw' })).data;
  const viaSecond = (await api<AuthResponse>('POST', `/admin/users/${bob.user.id}/impersonate`, secondSession.token)).data;
  assert.equal((await api('GET', '/projects', viaSecond.token)).status, 200);
  await api('PATCH', `/admin/users/${second.id}`, admin.token, { roles: ['user'] });
  assert.equal((await api('GET', '/projects', viaSecond.token)).status, 401);
  assert.equal((await api('DELETE', `/admin/users/${second.id}`, admin.token)).status, 204);
});

test('admin: edit a user, reset their password, see their detail', async () => {
  const id = bob.user.id;
  const edited = (await api<AdminUser>('PATCH', `/admin/users/${id}`, admin.token, { name: 'Bob B.', roles: ['developer'] })).data;
  assert.equal(edited.name, 'Bob B.');
  assert.deepEqual(edited.roles, ['user', 'developer']);
  assert.equal((await api('PATCH', `/admin/users/${id}`, admin.token, { email: 'alice@example.com' })).status, 409);

  assert.equal((await api('POST', `/admin/users/${id}/password`, admin.token, { password: 'short' })).status, 400);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await api('POST', `/admin/users/${id}/password`, admin.token, { password: 'new-password-from-admin' })).status, 200);
  assert.equal((await api('GET', '/projects', bob.token)).status, 401, 'old sessions end');
  assert.equal((await api('POST', '/auth/login', undefined, { email: 'bob@example.com', password: 'battery-staple' })).status, 401);
  bob = (await api<AuthResponse>('POST', '/auth/login', undefined, { email: 'bob@example.com', password: 'new-password-from-admin' })).data;

  const detail = (await api<AdminUserDetail>('GET', `/admin/users/${id}`, admin.token)).data;
  assert.ok(detail.projects.some((p) => p.name === 'Loud'));
  assert.ok(detail.recentActivity.length > 3);
  assert.equal((await api('DELETE', `/admin/users/${id}`, admin.token)).status, 400, 'Bob bought plugins: deactivate instead');
});

test('account: change your own password and stay signed in', async () => {
  assert.equal((await api('POST', '/auth/password', alice.token, { currentPassword: 'nope', newPassword: 'another-good-one' })).status, 400);
  const older = (await api<AuthResponse>('POST', '/auth/login', undefined, { email: 'alice@example.com', password: 'correct-horse' })).data;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const current = (await api<AuthResponse>('POST', '/auth/login', undefined, { email: 'alice@example.com', password: 'correct-horse' })).data;
  assert.equal((await api('POST', '/auth/password', current.token, { currentPassword: 'correct-horse', newPassword: 'another-good-one' })).status, 200);
  assert.equal((await api('GET', '/auth/me', current.token)).status, 200, 'this session continues');
  assert.equal((await api('GET', '/auth/me', older.token)).status, 401, 'earlier sessions are signed out');
  alice = current;
});

test('admin: reports show who is using the platform', async () => {
  const report = (await api<ReportOverview>('GET', '/admin/reports/overview?days=7', admin.token)).data;
  assert.equal(report.days, 7);
  assert.equal(report.series.length, 7);
  assert.equal(report.totals.users, 3);
  assert.equal(report.totals.active7d, 3);
  assert.equal(report.totals.activeToday, 3);
  assert.equal(report.totals.newUsersInPeriod, 3);
  assert.ok(report.totals.runsInPeriod >= 5);
  assert.equal(report.totals.exportsInPeriod, 1);
  assert.equal(report.totals.purchases, 2);
  assert.equal(report.totals.revenueCents, 1400);
  const today = report.series.at(-1)!;
  assert.equal(today.day, new Date().toISOString().slice(0, 10));
  assert.equal(today.activeUsers, 3);
  assert.equal(today.runs, report.totals.runsInPeriod);
  assert.deepEqual(report.exportsByLanguage, [{ language: 'csharp', count: 1 }]);
  assert.ok(report.projectsByType.some((p) => p.type === 'agent'));
  assert.ok(report.topPlugins.some((p) => p.id === 'aiui.email'));
  assert.equal(report.topUsers[0]!.email, 'alice@example.com');

  const first = (await api<ActivityPage>('GET', '/admin/reports/activity?limit=5', admin.token)).data;
  assert.equal(first.events.length, 5);
  assert.ok(first.nextBefore);
  const second = (await api<ActivityPage>('GET', `/admin/reports/activity?limit=5&before=${first.nextBefore}`, admin.token)).data;
  assert.ok(second.events[0]!.id < first.events.at(-1)!.id);
  const signIns = (await api<ActivityPage>('GET', '/admin/reports/activity?type=auth&limit=200', admin.token)).data;
  assert.ok(signIns.events.every((e) => e.type.startsWith('auth.')));
  assert.ok(signIns.events.some((e) => e.type === 'auth.login_failed'));
});

test('admin: moderate the marketplace', async () => {
  const plugins = (await api<AdminPlugin[]>('GET', '/admin/plugins', admin.token)).data;
  const shout = plugins.find((p) => p.id === 'alice.shout')!;
  assert.equal(shout.developerEmail, 'alice@example.com');
  assert.equal(shout.salesCount, 1);
  assert.equal(shout.revenueCents, 500);

  assert.equal((await api<AdminPlugin>('PATCH', '/admin/plugins/alice.shout', admin.token, { status: 'draft', official: true })).data.status, 'draft');
  assert.equal((await api('GET', '/market/plugins/alice.shout', bob.token)).status, 404, 'unpublished plugins leave the marketplace');
  const restored = (await api<AdminPlugin>('PATCH', '/admin/plugins/alice.shout', admin.token, { status: 'published' })).data;
  assert.ok(restored.official && restored.status === 'published');
  assert.equal((await api('PATCH', '/admin/plugins/aiui.core', admin.token, { status: 'draft' })).status, 400);
  assert.equal((await api('DELETE', '/admin/plugins/aiui.email', admin.token)).status, 400);
  assert.equal((await api('DELETE', '/admin/plugins/alice.shout', admin.token)).status, 400, 'it has sales');
});

test('admin: settings control sign-ups and who can run', async () => {
  assert.deepEqual((await api<PlatformSettings>('GET', '/admin/settings', admin.token)).data, { allowRegistration: true, runAccess: 'all' });
  assert.equal((await api('PUT', '/admin/settings', alice.token, { runAccess: 'none' })).status, 403);

  await api('PUT', '/admin/settings', admin.token, { runAccess: 'admins', allowRegistration: false });
  assert.equal((await api<MeResponse>('GET', '/auth/me', alice.token)).data.user.canRun, false);
  assert.equal((await api<MeResponse>('GET', '/auth/me', admin.token)).data.user.canRun, true);
  assert.equal((await api('POST', `/projects/${projectId}/run`, alice.token, {})).status, 403);
  const closed = await api<{ error: string }>('POST', '/auth/register', undefined, { email: 'late@example.com', name: 'Late', password: 'late-arrival-1' });
  assert.equal(closed.status, 403);
  assert.match(closed.data.error, /closed/);
  assert.equal((await api<{ allowRegistration: boolean }>('GET', '/config')).data.allowRegistration, false);
  assert.equal((await api('POST', '/admin/users', admin.token, { email: 'late@example.com', name: 'Late', password: 'late-arrival-1' })).status, 201, 'admins can still add people');

  await api('PUT', '/admin/settings', admin.token, { runAccess: 'none' });
  assert.equal((await api<{ allowRun: boolean }>('GET', '/config')).data.allowRun, false);
  await api('PUT', '/admin/settings', admin.token, { runAccess: 'all', allowRegistration: true });
});

test('public exposure: cross-origin access, private-address checks, sign-in throttling', async () => {
  const allowed = await fetch(`${BASE}/config`, { method: 'OPTIONS', headers: { Origin: 'https://app.example.com', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example.com');
  const other = await fetch(`${BASE}/config`, { headers: { Origin: 'https://evil.example.com' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);

  const local = (await api<Connection>('POST', '/connections', alice.token, { name: 'Inside', type: 'http_api', values: { baseUrl: 'http://127.0.0.1:1/', authType: 'none' } })).data;
  const refused = await api<{ error: string }>('POST', `/connections/${local.id}/test`, alice.token);
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /administrator/);
  const adminLocal = (await api<Connection>('POST', '/connections', admin.token, { name: 'Mock', type: 'http_api', values: { baseUrl: `${mock.url}/todos/1`, authType: 'none' } })).data;
  assert.equal((await api<{ ok: boolean }>('POST', `/connections/${adminLocal.id}/test`, admin.token)).data.ok, true);

  // Messaging Bridge: "Test" asks Telegram who the bot is.
  assert.equal((await api('POST', '/market/plugins/aiui.messaging/install', admin.token)).status, 200);
  const bot = (await api<Connection>('POST', '/connections', admin.token, { name: 'Bot', type: 'messaging_app', values: { service: 'telegram', apiBase: mock.url, token: 'good-token' } })).data;
  const tested = (await api<{ ok: boolean; message: string }>('POST', `/connections/${bot.id}/test`, admin.token)).data;
  assert.deepEqual(tested, { ok: true, message: 'Connected to Telegram as @aiui_test_bot.' });
  await api('PUT', `/connections/${bot.id}`, admin.token, { name: 'Bot', type: 'messaging_app', values: { service: 'telegram', apiBase: mock.url, token: 'bad-token' } });
  assert.equal((await api<{ ok: boolean }>('POST', `/connections/${bot.id}/test`, admin.token)).data.ok, false);

  let status = 0;
  for (let attempt = 0; attempt < 10; attempt++)
    status = (await api('POST', '/auth/login', undefined, { email: 'late@example.com', password: 'guess-' + attempt })).status;
  assert.equal(status, 429, 'repeated wrong passwords are throttled');
});
