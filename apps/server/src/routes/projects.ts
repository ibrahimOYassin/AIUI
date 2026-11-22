import crypto from 'node:crypto';
import { Router } from 'express';
import { strToU8, zipSync } from 'fflate';
import type {
  CreateProjectRequest,
  FlowEdge,
  FlowNode,
  GenerateResponse,
  Graph,
  Language,
  Project,
  ProjectSettings,
  ProjectSummary,
  ProjectType,
  RunRequest,
  UpdateProjectRequest,
} from '@aiui/shared';
import { type BuildInput, generate, safeName, validate } from '../codegen/index.ts';
import { now, sql } from '../db.ts';
import { HttpError, currentUser, requireAuth, text } from '../http.ts';
import { record } from '../platform.ts';
import { buildCatalog, userRegistry } from '../plugins.ts';
import { streamRun } from '../runner.ts';
import { resolvedConnections } from './connections.ts';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  type: ProjectType;
  graph: string;
  settings: string;
  created_at: string;
  updated_at: string;
}

const TYPES: ProjectType[] = ['workflow', 'agent', 'solution'];
const MAX_NODES = 500;

function toProject(row: ProjectRow): Project {
  return {
    id: row.id, name: row.name, description: row.description, type: row.type,
    graph: JSON.parse(row.graph) as Graph, settings: JSON.parse(row.settings) as ProjectSettings,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id, name: row.name, description: row.description, type: row.type,
    stepCount: (JSON.parse(row.graph) as Graph).nodes.length, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function ownedRow(userId: string, id: string): ProjectRow {
  const row = sql.get<ProjectRow>('SELECT * FROM projects WHERE id = ? AND owner_id = ?', id, userId);
  if (!row) throw new HttpError(404, 'Project not found.');
  return row;
}

/** Accept only the known shape; anything else is dropped. */
function cleanGraph(input: unknown): Graph {
  const raw = (input ?? {}) as Partial<Graph>;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new HttpError(400, 'The project data is not valid.');
  if (raw.nodes.length > MAX_NODES) throw new HttpError(400, `A project can have at most ${MAX_NODES} steps.`);
  const nodes: FlowNode[] = raw.nodes.map((n) => {
    if (typeof n?.id !== 'string' || typeof n.type !== 'string' || typeof n.name !== 'string') throw new HttpError(400, 'A step is missing its id, type or name.');
    const node: FlowNode = {
      id: n.id, type: n.type, name: n.name,
      position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 },
      config: n.config && typeof n.config === 'object' && !Array.isArray(n.config) ? n.config : {},
    };
    if (n.onError === 'continue') node.onError = 'continue';
    if (typeof n.notes === 'string' && n.notes) node.notes = n.notes.slice(0, 2000);
    if (n.tool && typeof n.tool === 'object') {
      node.tool = {
        description: typeof n.tool.description === 'string' ? n.tool.description : '',
        params: (Array.isArray(n.tool.params) ? n.tool.params : [])
          .filter((p) => typeof p?.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name))
          .map((p) => ({
            name: p.name,
            type: p.type === 'number' || p.type === 'boolean' ? p.type : 'string',
            description: typeof p.description === 'string' ? p.description : '',
            required: p.required !== false,
          })),
      };
    }
    return node;
  });
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) throw new HttpError(400, 'Two steps share the same id.');
  const edges: FlowEdge[] = raw.edges
    .filter((e) => typeof e?.source === 'string' && typeof e.target === 'string' && ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
    .map((e) => ({ id: typeof e.id === 'string' ? e.id : crypto.randomUUID(), source: e.source, sourcePort: typeof e.sourcePort === 'string' ? e.sourcePort : 'out', target: e.target }));
  return { nodes, edges };
}

function buildInput(userId: string, project: Project): BuildInput {
  const registry = userRegistry(userId);
  return { project, nodeTypes: registry.nodeTypes, connectionTypes: registry.connectionTypes, connections: resolvedConnections(userId) };
}

function language(value: unknown): Language {
  if (value === 'python' || value === 'csharp') return value;
  throw new HttpError(400, 'Choose "python" or "csharp".');
}

// ───────────────────────────── CRUD ─────────────────────────────

projectsRouter.get('/catalog', (req, res) => {
  res.json(buildCatalog(currentUser(req).id));
});

projectsRouter.get('/projects', (req, res) => {
  const rows = sql.all<ProjectRow>('SELECT * FROM projects WHERE owner_id = ? ORDER BY updated_at DESC', currentUser(req).id);
  res.json(rows.map(toSummary));
});

projectsRouter.post('/projects', (req, res) => {
  const user = currentUser(req);
  const body = (req.body ?? {}) as CreateProjectRequest;
  const name = text(body.name, 'name', 120);
  if (!TYPES.includes(body.type)) throw new HttpError(400, 'Choose a project type.');
  let graph: Graph = { nodes: [], edges: [] };
  if (body.templateId) {
    const template = buildCatalog(user.id).templates.find((t) => t.id === body.templateId);
    if (!template) throw new HttpError(400, 'That template is not available.');
    graph = cleanGraph(template.graph);
  }
  const id = crypto.randomUUID();
  const stamp = now();
  sql.run(
    'INSERT INTO projects (id, owner_id, name, description, type, graph, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, user.id, name, typeof body.description === 'string' ? body.description.slice(0, 1000) : '', body.type,
    JSON.stringify(graph), JSON.stringify({ defaultLanguage: 'python' } satisfies ProjectSettings), stamp, stamp,
  );
  record(req, 'project.create', `Created the project "${name}"`, { target: id, detail: body.type });
  res.status(201).json(toProject(ownedRow(user.id, id)));
});

projectsRouter.get('/projects/:id', (req, res) => {
  res.json(toProject(ownedRow(currentUser(req).id, req.params.id)));
});

projectsRouter.put('/projects/:id', (req, res) => {
  const user = currentUser(req);
  const row = ownedRow(user.id, req.params.id);
  const body = (req.body ?? {}) as UpdateProjectRequest;
  const current = toProject(row);
  const settings: ProjectSettings = { ...current.settings };
  if (body.settings?.defaultLanguage) settings.defaultLanguage = language(body.settings.defaultLanguage);
  sql.run(
    'UPDATE projects SET name = ?, description = ?, graph = ?, settings = ?, updated_at = ? WHERE id = ?',
    body.name !== undefined ? text(body.name, 'name', 120) : row.name,
    typeof body.description === 'string' ? body.description.slice(0, 1000) : row.description,
    body.graph !== undefined ? JSON.stringify(cleanGraph(body.graph)) : row.graph,
    JSON.stringify(settings), now(), row.id,
  );
  res.json(toProject(ownedRow(user.id, row.id)));
});

projectsRouter.delete('/projects/:id', (req, res) => {
  const row = ownedRow(currentUser(req).id, req.params.id);
  sql.run('DELETE FROM projects WHERE id = ?', row.id);
  record(req, 'project.delete', `Deleted the project "${row.name}"`, { target: row.id });
  res.status(204).end();
});

projectsRouter.post('/projects/:id/duplicate', (req, res) => {
  const user = currentUser(req);
  const row = ownedRow(user.id, req.params.id);
  const id = crypto.randomUUID();
  const stamp = now();
  sql.run(
    'INSERT INTO projects (id, owner_id, name, description, type, graph, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, user.id, `${row.name} (copy)`.slice(0, 120), row.description, row.type, row.graph, row.settings, stamp, stamp,
  );
  res.status(201).json(toProject(ownedRow(user.id, id)));
});

// ───────────────────────────── Build ─────────────────────────────

projectsRouter.post('/projects/:id/validate', (req, res) => {
  const user = currentUser(req);
  res.json({ issues: validate(buildInput(user.id, toProject(ownedRow(user.id, req.params.id)))) });
});

projectsRouter.post('/projects/:id/generate', (req, res) => {
  const user = currentUser(req);
  const input = buildInput(user.id, toProject(ownedRow(user.id, req.params.id)));
  const lang = language(req.body?.language);
  const response: GenerateResponse = { language: lang, files: generate(input, lang), issues: validate(input) };
  res.json(response);
});

projectsRouter.get('/projects/:id/export', (req, res) => {
  const user = currentUser(req);
  const project = toProject(ownedRow(user.id, req.params.id));
  const lang = language(req.query.language);
  const folder = safeName(project.name, lang === 'python' ? 'snake' : 'pascal');
  const entries: Record<string, Uint8Array> = {};
  for (const file of generate(buildInput(user.id, project), lang)) entries[`${folder}/${file.path}`] = strToU8(file.content);
  record(req, 'project.export', `Exported the project "${project.name}" as ${lang === 'python' ? 'Python' : 'C#'}`, { target: project.id, detail: lang });
  const zip = zipSync(entries, { level: 6 });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${folder}-${lang}.zip"`);
  res.end(Buffer.from(zip));
});

projectsRouter.post('/projects/:id/run', (req, res) => {
  const user = currentUser(req);
  if (!user.canRun) throw new HttpError(403, 'Running projects here is limited by the administrator. Export the project and run it on your own machine.');
  const project = toProject(ownedRow(user.id, req.params.id));
  const input = buildInput(user.id, project);
  const blocking = validate(input).filter((issue) => issue.severity === 'error');
  if (blocking.length) throw new HttpError(400, `Fix ${blocking.length === 1 ? 'this problem' : `these ${blocking.length} problems`} first: ${blocking.slice(0, 3).map((i) => i.message).join(' ')}`);
  const actor = { userId: user.id, impersonatorId: req.impersonatorId };
  streamRun(input, ((req.body ?? {}) as RunRequest).input, res, (status) =>
    record(actor, 'project.run', `Ran the project "${project.name}" (${status})`, { target: project.id, detail: status }));
});
