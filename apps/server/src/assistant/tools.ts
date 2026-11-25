/**
 * What the assistant can look up while it answers. Every tool runs as the person asking:
 * project and connection tools only ever read rows whose owner is that person, and guests
 * get the documentation tools only. Secrets are never included.
 */
import type { FieldDef, Project } from '@aiui/shared';
import { validate } from '../codegen/index.ts';
import { sql } from '../db.ts';
import { HttpError } from '../http.ts';
import { buildCatalog, userRegistry } from '../plugins.ts';
import { resolvedConnections } from '../routes/connections.ts';
import { type ProjectRow, buildInput, ownedRow, toProject } from '../routes/projects.ts';
import { type DocSection, searchDocs } from './knowledge.ts';

export interface ToolContext {
  /** Null for a guest. */
  userId: string | null;
  docs: DocSection[];
  /** Small local models have little room: return less per lookup. */
  compact?: boolean;
  /** Searches already made in this answer, so a model that repeats itself is told so. */
  searched?: Set<string>;
}

export interface AssistantTool {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, { type: 'string'; description: string }>; required: string[] };
  /** Available without an account. */
  guest: boolean;
  /** What the chat shows while the tool runs. */
  label: (input: Record<string, string>, ctx: ToolContext) => string;
  run: (input: Record<string, string>, ctx: ToolContext) => unknown;
}

const MAX_RESULT = 24_000;
const MAX_RESULT_COMPACT = 6_000;
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}\n…(cut short)` : value);

function needUser(ctx: ToolContext): string {
  if (!ctx.userId) throw new HttpError(401, 'The person asking is not signed in, so they have no projects or connections yet.');
  return ctx.userId;
}

const projectName = (userId: string, id: string) =>
  sql.get<{ name: string }>('SELECT name FROM projects WHERE id = ? AND owner_id = ?', id, userId)?.name;

/** A project as the assistant reads it: steps with their settings, the links between them, and any problems. */
function describeProject(userId: string, project: Project) {
  const input = buildInput(userId, project);
  const connections = new Map(input.connections.map((c) => [c.id, `${c.name} (${c.type})`]));
  const nameOf = new Map(project.graph.nodes.map((n) => [n.id, n.name]));
  const shown = (field: FieldDef | undefined, value: unknown): unknown => {
    if (field?.type === 'secret') return value ? '(hidden)' : '';
    if (field?.type === 'connection') {
      const ids = Array.isArray(value) ? value : [value];
      return ids.filter(Boolean).map((id) => connections.get(String(id)) ?? `missing connection ${String(id)}`);
    }
    return value;
  };
  return {
    id: project.id,
    name: project.name,
    type: project.type,
    description: project.description,
    link: `/projects/${project.id}`,
    updatedAt: project.updatedAt,
    steps: project.graph.nodes.map((node) => {
      const def = input.nodeTypes.get(node.type)?.def;
      const fields = new Map((def?.fields ?? []).map((f) => [f.key, f]));
      return {
        name: node.name,
        stepType: def ? `${def.label} (${node.type})` : `${node.type} (not installed)`,
        kind: def?.kind,
        settings: Object.fromEntries(Object.entries(node.config).map(([key, value]) => [fields.get(key)?.label ?? key, shown(fields.get(key), value)])),
        ...(node.notes ? { notes: node.notes } : {}),
        ...(node.onError === 'continue' ? { onError: 'continue' } : {}),
        ...(node.tool ? { usedAsTool: node.tool } : {}),
      };
    }),
    links: project.graph.edges.map((e) => `${nameOf.get(e.source)} --${e.sourcePort}--> ${nameOf.get(e.target)}`),
    problems: validate(input).map((issue) => ({
      severity: issue.severity,
      message: issue.message,
      ...(issue.nodeId ? { step: nameOf.get(issue.nodeId) } : {}),
    })),
  };
}

export const TOOLS: AssistantTool[] = [
  {
    name: 'search_docs',
    description:
      'Search the AIUI documentation (user guide, self-hosting guide, technical specification and notes from the administrator). ' +
      'Returns the best matching sections. Use it for any question about how AIUI works before answering from memory.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'A few keywords, e.g. "telegram bot connection"' } }, required: ['query'] },
    guest: true,
    label: () => 'Searching the documentation',
    run: ({ query }, ctx) => {
      const key = query.trim().toLowerCase();
      if (ctx.searched?.has(key)) return { note: 'You already searched for this. Use those results and answer now.' };
      ctx.searched?.add(key);
      const found = searchDocs(ctx.docs, query, ctx.compact ? 2 : 4);
      if (!found.length) return { results: [], note: 'Nothing matched. Try other words, or answer from what you know and say so.' };
      return { results: found.map((d) => ({ id: d.id, title: d.title, text: clip(d.text, ctx.compact ? 1500 : 5000) })) };
    },
  },
  {
    name: 'list_steps',
    description:
      'List the steps (building blocks) this person can use, from AIUI and their installed plugins, with what each does. ' +
      'Optionally filter by a word, e.g. "email" or "agent".',
    parameters: { type: 'object', properties: { filter: { type: 'string', description: 'Optional word to filter by; empty for all' } }, required: [] },
    guest: true,
    label: () => 'Looking through the step library',
    run: ({ filter }, ctx) => {
      const needle = (filter ?? '').trim().toLowerCase();
      return buildCatalog(ctx.userId ?? '')
        .nodeTypes.filter((n) => !needle || `${n.type} ${n.label} ${n.description} ${n.category} ${n.pluginName}`.toLowerCase().includes(needle))
        .map((n) => ({ type: n.type, label: n.label, kind: n.kind, category: n.category, description: n.description, plugin: n.pluginName }));
    },
  },
  {
    name: 'get_step',
    description: 'Get the full details of one step type: its settings (fields), inputs, outputs and the values it produces.',
    parameters: { type: 'object', properties: { type: { type: 'string', description: 'The step type, e.g. "ai.agent"' } }, required: ['type'] },
    guest: true,
    label: ({ type }) => `Reading about the step ${type}`,
    run: ({ type }, ctx) => {
      const entry = userRegistry(ctx.userId ?? '').nodeTypes.get(type);
      if (!entry) return { error: `There is no step "${type}" available to this person. Use list_steps to see the types.` };
      const { codegen: _code, ...def } = entry.def;
      return { ...def, plugin: entry.pluginName };
    },
  },
  {
    name: 'list_templates',
    description: 'List the ready-made project templates people can start from on Home.',
    parameters: { type: 'object', properties: {}, required: [] },
    guest: true,
    label: () => 'Looking at the templates',
    run: (_input, ctx) =>
      buildCatalog(ctx.userId ?? '').templates.map((t) => ({
        id: t.id, name: t.name, type: t.type, description: t.description, steps: t.graph.nodes.length, open: `/?template=${encodeURIComponent(t.id)}`,
      })),
  },
  {
    name: 'list_my_projects',
    description: "List the projects of the person you are talking to (only theirs), newest first. Optionally filter by a word in the name or description.",
    parameters: { type: 'object', properties: { filter: { type: 'string', description: 'Optional word to filter by; empty for all' } }, required: [] },
    guest: false,
    label: () => 'Looking at your projects',
    run: ({ filter }, ctx) => {
      const userId = needUser(ctx);
      const needle = (filter ?? '').trim().toLowerCase();
      return sql
        .all<ProjectRow>('SELECT * FROM projects WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 300', userId)
        .filter((row) => !needle || `${row.name} ${row.description}`.toLowerCase().includes(needle))
        .map((row) => {
          const graph = JSON.parse(row.graph) as Project['graph'];
          return {
            id: row.id, name: row.name, type: row.type, description: row.description, link: `/projects/${row.id}`,
            steps: graph.nodes.map((n) => n.name), updatedAt: row.updated_at,
          };
        });
    },
  },
  {
    name: 'get_project',
    description:
      "Read one of the person's own projects in full: its steps and their settings, how the steps are linked, and the problems AIUI found. " +
      'Use the id from list_my_projects, or the id of the project they have open.',
    parameters: { type: 'object', properties: { project_id: { type: 'string', description: 'The project id' } }, required: ['project_id'] },
    guest: false,
    label: ({ project_id }, ctx) => {
      const name = ctx.userId ? projectName(ctx.userId, project_id) : undefined;
      return name ? `Reading your project “${name}”` : 'Reading your project';
    },
    run: ({ project_id }, ctx) => {
      const userId = needUser(ctx);
      try {
        return describeProject(userId, toProject(ownedRow(userId, project_id)));
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return { error: 'This person has no project with that id.' };
        throw error;
      }
    },
  },
  {
    name: 'list_my_connections',
    description: "List the person's own connections (AI models and other services): name, type, settings and which secrets are filled in. Secret values are never shown.",
    parameters: { type: 'object', properties: {}, required: [] },
    guest: false,
    label: () => 'Looking at your connections',
    run: (_input, ctx) => {
      const userId = needUser(ctx);
      const types = userRegistry(userId).connectionTypes;
      return resolvedConnections(userId).map((c) => {
        const def = types.get(c.type);
        const secretKeys = (def?.fields ?? []).filter((f) => f.type === 'secret').map((f) => f.key);
        return {
          name: c.name,
          type: def ? `${def.label} (${c.type})` : c.type,
          settings: c.values,
          secrets: Object.fromEntries(secretKeys.map((key) => [key, c.secrets[key] ? 'filled in' : 'empty'])),
        };
      });
    },
  },
];

export function toolsFor(ctx: ToolContext): AssistantTool[] {
  return TOOLS.filter((t) => ctx.userId || t.guest);
}

/** Runs a tool and returns its result as text for the model. Problems come back as text too, so the model can recover. */
export function runTool(name: string, rawInput: unknown, ctx: ToolContext): { label: string; result: string; isError: boolean } {
  const tool = toolsFor(ctx).find((t) => t.name === name);
  if (!tool) return { label: 'Looking something up', result: `Unknown tool "${name}".`, isError: true };
  // Keep only the declared string parameters; anything else the model sends is ignored.
  const source = rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
  const input: Record<string, string> = {};
  for (const key of Object.keys(tool.parameters.properties)) if (typeof source[key] === 'string') input[key] = (source[key] as string).slice(0, 500);
  const missing = tool.parameters.required.filter((key) => !input[key]?.trim());
  if (missing.length) return { label: tool.label(input, ctx), result: `Missing ${missing.join(', ')}.`, isError: true };
  const label = tool.label(input, ctx);
  try {
    return { label, result: clip(JSON.stringify(tool.run(input, ctx)), ctx.compact ? MAX_RESULT_COMPACT : MAX_RESULT), isError: false };
  } catch (error) {
    return { label, result: error instanceof Error ? error.message : String(error), isError: true };
  }
}
