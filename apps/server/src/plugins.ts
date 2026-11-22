import fs from 'node:fs';
import path from 'node:path';
import type {
  Catalog,
  ConnectionTypeDef,
  FieldType,
  InstalledPlugin,
  NodeTypeDef,
  PluginManifest,
} from '@aiui/shared';
import { config } from './config.ts';
import { now, sql } from './db.ts';

export const SYSTEM_USER_ID = 'system';

interface ListingMeta {
  summary?: string;
  priceCents?: number;
  tags?: string[];
  builtin?: boolean;
}

// ───────────────────────────── Manifest validation ─────────────────────────────

const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'number', 'boolean', 'select', 'secret', 'connection', 'json', 'keyvalue', 'list'];
const NODE_KINDS = ['trigger', 'action', 'logic', 'ai'];
const MAX_MANIFEST_BYTES = 512 * 1024;

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function checkFields(fields: unknown, where: string, errors: string[]): void {
  if (!Array.isArray(fields)) {
    errors.push(`${where}: "fields" must be a list.`);
    return;
  }
  const keys = new Set<string>();
  for (const field of fields as Record<string, unknown>[]) {
    if (!isText(field?.key) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(field.key)) {
      errors.push(`${where}: every field needs a "key" made of letters, digits and underscores.`);
      continue;
    }
    if (keys.has(field.key)) errors.push(`${where}: field "${field.key}" is defined twice.`);
    keys.add(field.key);
    if (!isText(field.label)) errors.push(`${where}: field "${field.key}" needs a label.`);
    if (!FIELD_TYPES.includes(field.type as FieldType)) errors.push(`${where}: field "${field.key}" has unknown type "${String(field.type)}".`);
    if (field.type === 'select' && (!Array.isArray(field.options) || field.options.length === 0))
      errors.push(`${where}: select field "${field.key}" needs options.`);
    if (field.type === 'connection' && !isText(field.connectionType))
      errors.push(`${where}: connection field "${field.key}" needs "connectionType".`);
  }
}

/** Returns a list of problems; empty means the manifest is acceptable. */
export function validateManifest(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['The manifest must be a JSON object.'];
  if (JSON.stringify(input).length > MAX_MANIFEST_BYTES) return ['The manifest is larger than 512 KB.'];
  const manifest = input as Partial<PluginManifest>;

  if (!isText(manifest.id) || !/^[a-z0-9]+(\.[a-z0-9_-]+)+$/.test(manifest.id))
    errors.push('"id" must look like "yourname.plugin" (lowercase letters, digits, dots).');
  if (!isText(manifest.name)) errors.push('"name" is required.');
  if (!isText(manifest.version) || !/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push('"version" must look like 1.0.0.');
  if (!isText(manifest.description)) errors.push('"description" is required.');
  for (const key of ['author', 'icon', 'category'] as const) if (!isText(manifest[key])) errors.push(`"${key}" is required.`);

  const nodes = manifest.nodes;
  if (!Array.isArray(nodes)) return [...errors, '"nodes" must be a list (it may be empty).'];
  if (nodes.length === 0 && !manifest.connectionTypes?.length && !manifest.templates?.length)
    errors.push('The plugin adds nothing: include at least one step, connection type or template.');

  const types = new Set<string>();
  for (const node of nodes as Partial<NodeTypeDef>[]) {
    const where = `Step "${node?.type ?? '?'}"`;
    if (!isText(node?.type) || !/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(node.type)) {
      errors.push('Every step needs a "type" like "group.action" (lowercase letters, digits, underscores, dots).');
      continue;
    }
    if (types.has(node.type)) errors.push(`${where} is defined twice.`);
    types.add(node.type);
    if (!isText(node.label)) errors.push(`${where}: "label" is required.`);
    if (!isText(node.description)) errors.push(`${where}: "description" is required.`);
    if (!NODE_KINDS.includes(node.kind as string)) errors.push(`${where}: "kind" must be one of ${NODE_KINDS.join(', ')}.`);
    if (!isText(node.category)) errors.push(`${where}: "category" is required.`);
    if (!isText(node.icon)) errors.push(`${where}: "icon" is required.`);
    if (!Array.isArray(node.inputs) || !Array.isArray(node.outputs)) errors.push(`${where}: "inputs" and "outputs" must be lists.`);
    else {
      if (node.kind === 'trigger' && node.inputs.length > 0) errors.push(`${where}: a trigger cannot have inputs.`);
      if (node.kind !== 'trigger' && node.inputs.length !== 1) errors.push(`${where}: a step needs exactly one input.`);
      if (node.outputs.length === 0) errors.push(`${where}: at least one output is required.`);
      for (const port of [...node.inputs, ...node.outputs])
        if (!isText(port?.id) || !isText(port?.label)) errors.push(`${where}: every port needs "id" and "label".`);
    }
    checkFields(node.fields, where, errors);
    const python = node.codegen?.python;
    const csharp = node.codegen?.csharp;
    if (!isText(python?.source) || !/def\s+run\s*\(/.test(python.source))
      errors.push(`${where}: Python source is required and must define "def run(cfg, ctx)".`);
    if (!isText(csharp?.source) || !isText(csharp?.className)) errors.push(`${where}: C# source and "className" are required.`);
    else if (!/^[A-Z][A-Za-z0-9]*$/.test(csharp.className)) errors.push(`${where}: C# "className" must be PascalCase.`);
    else if (!csharp.source.includes(csharp.className) || !/RunAsync\s*\(/.test(csharp.source))
      errors.push(`${where}: C# source must declare class ${csharp.className} with a RunAsync method.`);
  }

  for (const connection of (manifest.connectionTypes ?? []) as Partial<ConnectionTypeDef>[]) {
    const where = `Connection type "${connection?.type ?? '?'}"`;
    if (!isText(connection?.type) || !/^[a-z0-9_]+$/.test(connection.type)) {
      errors.push('Every connection type needs a "type" (lowercase letters, digits, underscores).');
      continue;
    }
    if (!isText(connection.label)) errors.push(`${where}: "label" is required.`);
    checkFields(connection.fields, where, errors);
  }

  for (const template of manifest.templates ?? []) {
    if (!isText(template?.id) || !isText(template?.name)) errors.push('Every template needs "id" and "name".');
    else if (!Array.isArray(template.graph?.nodes) || !Array.isArray(template.graph?.edges))
      errors.push(`Template "${template.name}": "graph" needs "nodes" and "edges".`);
  }
  return errors;
}

/** -1, 0 or 1 for semantic versions like 1.2.3. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) > (right[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

// ───────────────────────────── First-party plugins ─────────────────────────────

/** Reads plugins/<id>/plugin.json and inlines the .py / .cs source of every step. */
export function loadFirstPartyPlugins(): { manifest: PluginManifest; listing: ListingMeta }[] {
  const result: { manifest: PluginManifest; listing: ListingMeta }[] = [];
  if (!fs.existsSync(config.pluginsDir)) return result;
  for (const entry of fs.readdirSync(config.pluginsDir, { withFileTypes: true })) {
    const file = path.join(config.pluginsDir, entry.name, 'plugin.json');
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as PluginManifest & { listing?: ListingMeta };
    const { listing = {}, ...manifest } = raw;
    for (const node of manifest.nodes) {
      const base = path.join(config.pluginsDir, entry.name, node.type);
      const partial = (node.codegen ?? {}) as Partial<NodeTypeDef['codegen']>;
      node.codegen = {
        python: { requirements: [], ...partial.python, source: fs.readFileSync(`${base}.py`, 'utf8') },
        csharp: { packages: [], className: '', ...partial.csharp, source: fs.readFileSync(`${base}.cs`, 'utf8') },
      };
    }
    const problems = validateManifest(manifest);
    if (problems.length) throw new Error(`Plugin ${entry.name} is invalid:\n  ${problems.join('\n  ')}`);
    result.push({ manifest, listing });
  }
  return result;
}

/** Publishes the first-party plugins into the marketplace tables. Safe to run on every start. */
export function seedPlugins(): void {
  if (!sql.get('SELECT id FROM users WHERE id = ?', SYSTEM_USER_ID)) {
    sql.run(
      'INSERT INTO users (id, email, name, password_hash, roles, developer_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      SYSTEM_USER_ID, 'system@aiui.local', 'AIUI', '!', JSON.stringify(['developer']), 'AIUI', now(),
    );
  }
  for (const { manifest, listing } of loadFirstPartyPlugins()) {
    const stamp = now();
    const existing = sql.get('SELECT id FROM plugins WHERE id = ?', manifest.id);
    const values = [
      manifest.name, listing.summary ?? manifest.description, manifest.description, manifest.category, manifest.icon,
      JSON.stringify(listing.tags ?? []), listing.priceCents ?? 0, listing.builtin ? 1 : 0, stamp,
    ] as const;
    if (existing) {
      sql.run(
        `UPDATE plugins SET name = ?, summary = ?, description = ?, category = ?, icon = ?, tags = ?, price_cents = ?,
           builtin = ?, updated_at = ?, status = 'published', official = 1 WHERE id = ?`,
        ...values, manifest.id,
      );
    } else {
      sql.run(
        `INSERT INTO plugins (name, summary, description, category, icon, tags, price_cents, builtin, updated_at,
           id, developer_id, status, official, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1, ?)`,
        ...values, manifest.id, SYSTEM_USER_ID, stamp,
      );
    }
    sql.run(
      `INSERT INTO plugin_versions (plugin_id, version, manifest, changelog, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (plugin_id, version) DO UPDATE SET manifest = excluded.manifest`,
      manifest.id, manifest.version, JSON.stringify(manifest), 'Initial release.', stamp,
    );
  }
}

// ───────────────────────────── What a user has ─────────────────────────────

export function latestVersion(pluginId: string): { version: string; manifest: PluginManifest } | undefined {
  const rows = sql.all<{ version: string; manifest: string }>('SELECT version, manifest FROM plugin_versions WHERE plugin_id = ?', pluginId);
  if (rows.length === 0) return undefined;
  const best = rows.reduce((a, b) => (compareVersions(a.version, b.version) >= 0 ? a : b));
  return { version: best.version, manifest: JSON.parse(best.manifest) as PluginManifest };
}

interface UserPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  builtin: boolean;
  latest: string;
}

/** Built-in plugins (always present) plus everything the user installed. */
export function userPlugins(userId: string): UserPlugin[] {
  const result: UserPlugin[] = [];
  for (const row of sql.all<{ id: string }>("SELECT id FROM plugins WHERE builtin = 1 ORDER BY id")) {
    const latest = latestVersion(row.id);
    if (latest) result.push({ manifest: latest.manifest, enabled: true, builtin: true, latest: latest.version });
  }
  const installs = sql.all<{ plugin_id: string; version: string; enabled: number }>(
    `SELECT i.plugin_id, i.version, i.enabled FROM installs i JOIN plugins p ON p.id = i.plugin_id
     WHERE i.user_id = ? AND p.builtin = 0 ORDER BY i.created_at`,
    userId,
  );
  for (const install of installs) {
    const row = sql.get<{ manifest: string }>('SELECT manifest FROM plugin_versions WHERE plugin_id = ? AND version = ?', install.plugin_id, install.version);
    if (!row) continue;
    result.push({
      manifest: JSON.parse(row.manifest) as PluginManifest,
      enabled: install.enabled === 1,
      builtin: false,
      latest: latestVersion(install.plugin_id)?.version ?? install.version,
    });
  }
  return result;
}

export interface NodeTypeEntry {
  def: NodeTypeDef;
  pluginId: string;
  pluginName: string;
}

/** Step types (with source) and connection types available to a user, from enabled plugins. */
export function userRegistry(userId: string): { nodeTypes: Map<string, NodeTypeEntry>; connectionTypes: Map<string, ConnectionTypeDef> } {
  const nodeTypes = new Map<string, NodeTypeEntry>();
  const connectionTypes = new Map<string, ConnectionTypeDef>();
  for (const plugin of userPlugins(userId)) {
    if (!plugin.enabled) continue;
    for (const def of plugin.manifest.nodes) {
      if (!nodeTypes.has(def.type)) nodeTypes.set(def.type, { def, pluginId: plugin.manifest.id, pluginName: plugin.manifest.name });
    }
    for (const def of plugin.manifest.connectionTypes ?? []) if (!connectionTypes.has(def.type)) connectionTypes.set(def.type, def);
  }
  return { nodeTypes, connectionTypes };
}

/** Everything the IDE needs to render the step library and forms. Step source is not included. */
export function buildCatalog(userId: string): Catalog {
  const catalog: Catalog = { nodeTypes: [], connectionTypes: [], templates: [], plugins: [] };
  const seenNodes = new Set<string>();
  const seenConnections = new Set<string>();
  for (const plugin of userPlugins(userId)) {
    const { manifest } = plugin;
    const summary: InstalledPlugin = {
      id: manifest.id, name: manifest.name, version: manifest.version, latestVersion: plugin.latest,
      description: manifest.description, icon: manifest.icon, category: manifest.category, author: manifest.author,
      enabled: plugin.enabled, builtin: plugin.builtin, nodeCount: manifest.nodes.length,
    };
    catalog.plugins.push(summary);
    if (!plugin.enabled) continue;
    for (const node of manifest.nodes) {
      if (seenNodes.has(node.type)) continue;
      seenNodes.add(node.type);
      const { codegen: _source, ...info } = node;
      catalog.nodeTypes.push({ ...info, pluginId: manifest.id, pluginName: manifest.name });
    }
    for (const connection of manifest.connectionTypes ?? []) {
      if (seenConnections.has(connection.type)) continue;
      seenConnections.add(connection.type);
      catalog.connectionTypes.push({ ...connection, pluginId: manifest.id });
    }
    for (const template of manifest.templates ?? []) catalog.templates.push({ ...template, pluginId: manifest.id });
  }
  return catalog;
}
