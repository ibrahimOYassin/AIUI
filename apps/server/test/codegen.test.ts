/**
 * Generates real projects from the first-party plugins and runs them.
 *   npm test                      Python only (needs `python` on PATH)
 *   AIUI_TEST_DOTNET=1 npm test   also builds and runs the C# output (slow)
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ConnectionTypeDef, Graph, Language, Project, RunEvent } from '@aiui/shared';

process.env.AIUI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aiui-test-data-'));
const { loadFirstPartyPlugins } = await import('../src/plugins.ts');
const { generate, validate } = await import('../src/codegen/index.ts');
type BuildInput = import('../src/codegen/index.ts').BuildInput;
type NodeTypeEntry = import('../src/plugins.ts').NodeTypeEntry;

const plugins = loadFirstPartyPlugins();
const nodeTypes = new Map<string, NodeTypeEntry>();
const connectionTypes = new Map<string, ConnectionTypeDef>();
for (const { manifest } of plugins) {
  for (const def of manifest.nodes) nodeTypes.set(def.type, { def, pluginId: manifest.id, pluginName: manifest.name });
  for (const def of manifest.connectionTypes ?? []) connectionTypes.set(def.type, def);
}

function project(name: string, graph: Graph): Project {
  return {
    id: 'p1', name, description: '', type: 'workflow', graph,
    settings: { defaultLanguage: 'python' }, createdAt: '', updatedAt: '',
  };
}

function input(graph: Graph, connections: BuildInput['connections'] = []): BuildInput {
  return { project: project('Test Flow', graph), nodeTypes, connectionTypes, connections };
}

function writeProject(build: BuildInput, language: Language): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aiui-test-${language}-`));
  for (const file of generate(build, language)) {
    const target = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content);
  }
  return dir;
}

function parseEvents(stdout: string): RunEvent[] {
  return stdout.split(/\r?\n/).filter((line) => line.startsWith('@@AIUI ')).map((line) => JSON.parse(line.slice(7)) as RunEvent);
}

/** Offline flow that exercises references, variables, a loop and a condition. */
const offline: Graph = {
  nodes: [
    { id: 't1', type: 'trigger.manual', name: 'start', position: { x: 0, y: 0 }, config: { sampleInput: { numbers: [1, 2, 3], name: 'Ada' } } },
    { id: 's1', type: 'logic.set', name: 'remember', position: { x: 0, y: 0 }, config: { values: { greeting: 'Hello {{input.name}}' } } },
    { id: 'l1', type: 'logic.loop', name: 'each_number', position: { x: 0, y: 0 }, config: { items: '{{input.numbers}}' } },
    { id: 'c1', type: 'logic.if', name: 'is_big', position: { x: 0, y: 0 }, config: { left: '{{item}}', operator: 'greater', right: '1' } },
    { id: 'g1', type: 'util.log', name: 'log_big', position: { x: 0, y: 0 }, config: { message: 'big {{item}} at {{index}}' } },
    { id: 'g2', type: 'util.log', name: 'log_small', position: { x: 0, y: 0 }, config: { message: 'small {{item}}' } },
    { id: 'g3', type: 'util.log', name: 'summary', position: { x: 0, y: 0 }, config: { message: '{{vars.greeting}}: {{each_number.count}} items' } },
  ],
  edges: [
    { id: 'e1', source: 't1', sourcePort: 'out', target: 's1' },
    { id: 'e2', source: 's1', sourcePort: 'out', target: 'l1' },
    { id: 'e3', source: 'l1', sourcePort: 'item', target: 'c1' },
    { id: 'e4', source: 'c1', sourcePort: 'true', target: 'g1' },
    { id: 'e5', source: 'c1', sourcePort: 'false', target: 'g2' },
    { id: 'e6', source: 'l1', sourcePort: 'done', target: 'g3' },
  ],
};

function checkOfflineRun(events: RunEvent[]) {
  const logs = events.filter((e) => e.type === 'log').map((e) => (e as { message: string }).message);
  assert.deepEqual(logs, ['small 1', 'big 2 at 1', 'big 3 at 2', 'Hello Ada: 3 items']);
  const end = events.at(-1);
  assert.equal(end?.type, 'run_end');
  assert.equal((end as { status: string }).status, 'success');
  assert.deepEqual((end as { output: unknown }).output, { message: 'Hello Ada: 3 items' });
}

test('first-party plugins load and validate', () => {
  assert.ok(plugins.length >= 9);
  assert.ok(nodeTypes.size >= 20);
});

test('validation reports missing fields, bad references and unlinked steps', () => {
  const graph: Graph = {
    nodes: [
      { id: 't1', type: 'trigger.manual', name: 'start', position: { x: 0, y: 0 }, config: {} },
      { id: 'a1', type: 'ai.prompt', name: 'ask', position: { x: 0, y: 0 }, config: { prompt: '{{nowhere.text}}' } },
      { id: 'x1', type: 'util.log', name: 'lonely', position: { x: 0, y: 0 }, config: { message: 'hi' } },
      { id: 'u1', type: 'gone.step', name: 'missing', position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [{ id: 'e1', source: 't1', sourcePort: 'out', target: 'a1' }],
  };
  const issues = validate(input(graph));
  assert.ok(issues.some((i) => i.severity === 'error' && i.nodeId === 'a1' && i.field === 'connection'));
  assert.ok(issues.some((i) => i.severity === 'warning' && i.message.includes('nowhere')));
  assert.ok(issues.some((i) => i.severity === 'warning' && i.nodeId === 'x1'));
  assert.ok(issues.some((i) => i.severity === 'error' && i.nodeId === 'u1'));
  assert.deepEqual(validate(input(offline)), []);
});

test('secrets never appear in generated files', () => {
  const graph: Graph = {
    nodes: [
      { id: 't1', type: 'trigger.manual', name: 'start', position: { x: 0, y: 0 }, config: {} },
      { id: 'a1', type: 'ai.prompt', name: 'ask', position: { x: 0, y: 0 }, config: { connection: 'c1', prompt: 'Hi' } },
    ],
    edges: [{ id: 'e1', source: 't1', sourcePort: 'out', target: 'a1' }],
  };
  const connections = [{ id: 'c1', name: 'My Claude', type: 'llm', values: { provider: 'anthropic', model: 'claude-opus-5-5' }, secrets: { apiKey: 'sk-very-secret' } }];
  for (const language of ['python', 'csharp'] as Language[]) {
    const files = generate(input(graph, connections), language);
    assert.ok(!files.some((f) => f.content.includes('sk-very-secret')), `${language} output leaked a secret`);
    assert.ok(files.find((f) => f.path === 'connections.json')!.content.includes('${AIUI_MY_CLAUDE_API_KEY}'));
    assert.ok(files.find((f) => f.path === '.env.example')!.content.includes('AIUI_MY_CLAUDE_API_KEY='));
  }
  assert.ok(generate(input(graph, connections), 'python').find((f) => f.path === 'requirements.txt')!.content.includes('anthropic'));
  assert.ok(generate(input(graph, connections), 'csharp').some((f) => f.path === 'Runtime/AnthropicChat.cs'));
});

test('every template generates in both languages', () => {
  for (const { manifest } of plugins) {
    for (const template of manifest.templates ?? []) {
      for (const language of ['python', 'csharp'] as Language[]) {
        const files = generate(input(template.graph), language);
        assert.ok(files.length > 5, `${template.id} ${language}`);
      }
    }
  }
});

test('generated Python project runs', () => {
  const dir = writeProject(input(offline), 'python');
  const result = spawnSync(process.env.AIUI_PYTHON ?? 'python', ['main.py', '--events', '--once'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  checkOfflineRun(parseEvents(result.stdout));
});

test('every Python step module compiles', () => {
  const graph: Graph = {
    nodes: [...nodeTypes.keys()].map((type, i) => ({ id: `n${i}`, type, name: `step_${i}`, position: { x: 0, y: 0 }, config: {} })),
    edges: [],
  };
  const dir = writeProject(input(graph), 'python');
  execFileSync(process.env.AIUI_PYTHON ?? 'python', ['-m', 'compileall', '-q', '.'], { cwd: dir });
});

test('generated C# project builds and runs', { skip: process.env.AIUI_TEST_DOTNET !== '1' }, () => {
  // All step types in one project so every Steps/*.cs file is compiled.
  const extra = [...nodeTypes.keys()].filter((type) => !offline.nodes.some((n) => n.type === type) && !type.startsWith('trigger.'));
  const graph: Graph = {
    nodes: [...offline.nodes, ...extra.map((type, i) => ({ id: `x${i}`, type, name: `extra_${i}`, position: { x: 0, y: 0 }, config: {} }))],
    edges: offline.edges,
  };
  const dir = writeProject(input(graph), 'csharp');
  const result = spawnSync('dotnet', ['run', '--', '--events', '--once'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  checkOfflineRun(parseEvents(result.stdout));
});
