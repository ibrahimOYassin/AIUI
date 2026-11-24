import type { ConnectionTypeDef, FieldDef, FlowNode, GeneratedFile, Graph, Issue, Language, Project } from '@aiui/shared';
import { RESERVED_NAMES } from '@aiui/shared';
import type { NodeTypeEntry } from '../plugins.ts';
import { generatePython } from './python.ts';
import { generateCSharp } from './csharp.ts';

export interface ResolvedConnection {
  id: string;
  name: string;
  type: string;
  values: Record<string, unknown>;
  /** Decrypted secret fields. Only ever leaves the server as environment variables of a run. */
  secrets: Record<string, string>;
}

export interface BuildInput {
  project: Project;
  nodeTypes: Map<string, NodeTypeEntry>;
  connectionTypes: Map<string, ConnectionTypeDef>;
  connections: ResolvedConnection[];
}

/** Everything both generators need, computed once. */
export interface BuildPlan {
  project: Project;
  /** Steps whose type is available, in a stable order. */
  nodes: (FlowNode & { kind: string })[];
  edges: { source: string; sourcePort: string; target: string }[];
  /** Distinct step types used, sorted. */
  types: NodeTypeEntry[];
  /** connections.json content: secrets replaced by ${ENV_VAR}. */
  connectionsFile: Record<string, { name: string; type: string; values: Record<string, unknown> }>;
  /** ENV_VAR → real secret, for running inside the IDE. */
  secretEnv: Record<string, string>;
  usesAnthropic: boolean;
}

// ───────────────────────────── Helpers ─────────────────────────────

const REF = /\{\{\s*([^{}]+?)\s*\}\}/g;

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function fieldVisible(field: FieldDef, config: Record<string, unknown>, fields: FieldDef[]): boolean {
  if (!field.showIf) return true;
  const other = fields.find((f) => f.key === field.showIf!.field);
  const actual = config[field.showIf.field] ?? other?.default;
  const expected = field.showIf.equals;
  return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
}

function connectionIds(node: FlowNode, fields: FieldDef[]): string[] {
  const ids: string[] = [];
  for (const field of fields) {
    if (field.type !== 'connection') continue;
    const value = node.config[field.key];
    if (typeof value === 'string' && value) ids.push(value);
    else if (Array.isArray(value)) ids.push(...value.filter((v): v is string => typeof v === 'string' && v.length > 0));
  }
  return ids;
}

export function envName(connectionName: string, key: string): string {
  const clean = (text: string) => text.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  return `AIUI_${clean(connectionName) || 'CONNECTION'}_${clean(key)}`;
}

/** A filesystem- and identifier-safe project name. */
export function safeName(name: string, style: 'snake' | 'pascal'): string {
  const words = name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return style === 'snake' ? 'aiui_project' : 'AiuiProject';
  const result = style === 'snake'
    ? words.map((w) => w.toLowerCase()).join('_')
    : words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
  return /^[0-9]/.test(result) ? (style === 'snake' ? `p_${result}` : `P${result}`) : result;
}

// ───────────────────────────── Validation ─────────────────────────────

export function validate(input: BuildInput): Issue[] {
  const { project, nodeTypes } = input;
  const graph: Graph = project.graph;
  const issues: Issue[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const connectionById = new Map(input.connections.map((c) => [c.id, c]));

  if (graph.nodes.length === 0) {
    issues.push({ severity: 'error', message: 'The project is empty. Add a step that starts the flow.' });
    return issues;
  }

  const triggers = graph.nodes.filter((n) => nodeTypes.get(n.type)?.def.kind === 'trigger');
  if (triggers.length === 0) issues.push({ severity: 'error', message: 'Nothing starts this flow. Add a step from the "Start" group.' });
  for (const extra of triggers.slice(1))
    issues.push({ severity: 'error', nodeId: extra.id, message: 'A project can have only one starting step. Remove this one or the other.' });

  const names = new Map<string, number>();
  for (const node of graph.nodes) names.set(node.name, (names.get(node.name) ?? 0) + 1);
  const toolTargets = new Set(graph.edges.filter((e) => e.sourcePort === 'tools').map((e) => e.target));

  for (const node of graph.nodes) {
    const entry = nodeTypes.get(node.type);
    if (!entry) {
      issues.push({ severity: 'error', nodeId: node.id, message: `"${node.name}" needs a plugin that is not installed (step type ${node.type}).` });
      continue;
    }
    const { def } = entry;
    if (!/^[a-z][a-z0-9_]*$/.test(node.name)) issues.push({ severity: 'error', nodeId: node.id, message: `The name "${node.name}" may only contain lowercase letters, digits and underscores.` });
    else if (RESERVED_NAMES.includes(node.name)) issues.push({ severity: 'error', nodeId: node.id, message: `"${node.name}" is a reserved name. Rename the step.` });
    else if ((names.get(node.name) ?? 0) > 1) issues.push({ severity: 'error', nodeId: node.id, message: `Two steps are named "${node.name}". Names must be unique.` });

    for (const field of def.fields) {
      if (!fieldVisible(field, node.config, def.fields)) continue;
      const value = node.config[field.key];
      if (field.required && isEmpty(value) && isEmpty(field.default))
        issues.push({ severity: 'error', nodeId: node.id, field: field.key, message: `${def.label} "${node.name}": "${field.label}" is required.` });
      if (field.type === 'connection') {
        for (const id of connectionIds(node, [field])) {
          const connection = connectionById.get(id);
          if (!connection) issues.push({ severity: 'error', nodeId: node.id, field: field.key, message: `${def.label} "${node.name}": the selected connection for "${field.label}" no longer exists.` });
          else if (field.connectionType && connection.type !== field.connectionType)
            issues.push({ severity: 'error', nodeId: node.id, field: field.key, message: `${def.label} "${node.name}": "${connection.name}" is the wrong kind of connection for "${field.label}".` });
        }
      }
    }

    for (const match of JSON.stringify(node.config).matchAll(REF)) {
      const root = match[1]!.split('.')[0]!.trim();
      if (!RESERVED_NAMES.includes(root) && !names.has(root))
        issues.push({ severity: 'warning', nodeId: node.id, message: `"${node.name}" uses data from "${root}", but no step has that name.` });
    }

    if (toolTargets.has(node.id) && !node.tool?.description?.trim())
      issues.push({ severity: 'warning', nodeId: node.id, message: `"${node.name}" is used as an agent tool. Describe what it does in Tool settings so the agent knows when to use it.` });
  }

  for (const edge of graph.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const source = nodeTypes.get(byId.get(edge.source)!.type)?.def;
    if (source && edge.sourcePort === 'tools' && !source.toolPort)
      issues.push({ severity: 'error', nodeId: edge.source, message: `"${byId.get(edge.source)!.name}" has no Tools port.` });
  }

  // Steps the flow can never reach.
  if (triggers[0]) {
    const reached = new Set<string>([triggers[0].id]);
    const queue = [triggers[0].id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of graph.edges) {
        if (edge.source === current && byId.has(edge.target) && !reached.has(edge.target)) {
          reached.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
    for (const node of graph.nodes)
      if (!reached.has(node.id) && nodeTypes.has(node.type))
        issues.push({ severity: 'warning', nodeId: node.id, message: `"${node.name}" is not linked to the flow and will never run.` });
  }
  return issues;
}

// ───────────────────────────── Planning ─────────────────────────────

export function plan(input: BuildInput): BuildPlan {
  const { project, nodeTypes } = input;
  const ids = new Set<string>();
  const nodes = project.graph.nodes
    .filter((node) => nodeTypes.has(node.type))
    .map((node) => {
      const def = nodeTypes.get(node.type)!.def;
      // Fill in defaults so the exported project does not depend on the IDE.
      const config: Record<string, unknown> = {};
      for (const field of def.fields) {
        const value = node.config[field.key];
        if (value !== undefined) config[field.key] = value;
        else if (field.default !== undefined) config[field.key] = field.default;
      }
      for (const id of connectionIds({ ...node, config }, def.fields)) ids.add(id);
      return { ...node, config, kind: def.kind };
    });
  const known = new Set(nodes.map((n) => n.id));
  const edges = project.graph.edges
    .filter((e) => known.has(e.source) && known.has(e.target))
    .map((e) => ({ source: e.source, sourcePort: e.sourcePort, target: e.target }));

  const types = [...new Set(nodes.map((n) => n.type))].sort().map((type) => nodeTypes.get(type)!);

  const connectionsFile: BuildPlan['connectionsFile'] = {};
  const secretEnv: Record<string, string> = {};
  let usesAnthropic = false;
  for (const connection of input.connections) {
    if (!ids.has(connection.id)) continue;
    const values: Record<string, unknown> = { ...connection.values };
    // Secret fields hidden for this connection (another service's, say) are left out of .env.
    const typeFields = input.connectionTypes.get(connection.type)?.fields ?? [];
    const secretKeys = new Set([
      ...Object.keys(connection.secrets),
      ...typeFields.filter((f) => f.type === 'secret' && fieldVisible(f, connection.values, typeFields)).map((f) => f.key),
    ]);
    for (const key of secretKeys) {
      const variable = envName(connection.name, key);
      values[key] = `\${${variable}}`;
      secretEnv[variable] = connection.secrets[key] ?? '';
    }
    connectionsFile[connection.id] = { name: connection.name, type: connection.type, values };
    if (connection.type === 'llm' && connection.values.provider === 'anthropic') usesAnthropic = true;
  }
  return { project, nodes, edges, types, connectionsFile, secretEnv, usesAnthropic };
}

export function generate(input: BuildInput, language: Language): GeneratedFile[] {
  const built = plan(input);
  const files = language === 'python' ? generatePython(built) : generateCSharp(built);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Shared between both generators. */
export function envExample(built: BuildPlan): string {
  const lines = ['# Copy this file to ".env" and fill in the values. Never commit ".env".'];
  const variables = Object.keys(built.secretEnv).sort();
  if (variables.length === 0) lines.push('# This project needs no secrets.');
  for (const variable of variables) lines.push(`${variable}=`);
  return lines.join('\n') + '\n';
}

export function describeFlow(built: BuildPlan): string {
  const lines: string[] = [];
  for (const node of built.nodes) {
    const label = built.types.find((t) => t.def.type === node.type)?.def.label ?? node.type;
    lines.push(`- **${node.name}** — ${label}`);
  }
  return lines.join('\n');
}
