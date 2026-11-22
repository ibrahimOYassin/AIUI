import { Router } from 'express';
import type { DevListing, Earnings, PluginManifest, SaveDevPluginRequest, ValidateManifestResponse } from '@aiui/shared';
import { now, sql } from '../db.ts';
import { HttpError, requireAuth, requireDeveloper } from '../http.ts';
import { record } from '../platform.ts';
import { compareVersions, latestVersion, validateManifest } from '../plugins.ts';
import { type PluginRow, toListing } from './market.ts';

export const devRouter = Router();
devRouter.use(requireAuth);

function ownRow(id: string, developerId: string): PluginRow {
  const row = sql.get<PluginRow>('SELECT * FROM plugins WHERE id = ? AND developer_id = ?', id, developerId);
  if (!row) throw new HttpError(404, 'Plugin not found.');
  return row;
}

function toDevListing(row: PluginRow, userId: string): DevListing {
  const latest = latestVersion(row.id)!;
  const sales = sql.get<{ count: number; total: number | null }>('SELECT COUNT(*) AS count, SUM(developer_cents) AS total FROM purchases WHERE plugin_id = ?', row.id);
  return {
    ...toListing(row, userId, latest.manifest),
    description: row.description,
    salesCount: sales?.count ?? 0,
    earningsCents: sales?.total ?? 0,
    manifest: latest.manifest,
  };
}

/** Manifest problems, including clashes with steps other plugins already provide. */
function problems(manifest: unknown, ownId?: string): string[] {
  const errors = validateManifest(manifest);
  if (errors.length) return errors;
  const candidate = manifest as PluginManifest;
  if (candidate.id.startsWith('aiui.')) errors.push('Plugin ids starting with "aiui." are reserved.');
  const nodeTypes = new Set(candidate.nodes.map((n) => n.type));
  const connectionTypes = new Set((candidate.connectionTypes ?? []).map((c) => c.type));
  for (const other of sql.all<{ id: string }>('SELECT id FROM plugins WHERE id != ?', ownId ?? candidate.id)) {
    const existing = latestVersion(other.id)?.manifest;
    if (!existing) continue;
    for (const node of existing.nodes)
      if (nodeTypes.has(node.type)) errors.push(`Step type "${node.type}" is already provided by the plugin "${existing.name}". Choose another type id.`);
    for (const connection of existing.connectionTypes ?? [])
      if (connectionTypes.has(connection.type)) errors.push(`Connection type "${connection.type}" is already provided by "${existing.name}". Reuse it, or pick another id.`);
  }
  return errors;
}

function price(value: unknown): number {
  if (value === undefined) return 0;
  const cents = Number(value);
  if (!Number.isInteger(cents) || cents < 0 || cents > 100_000) throw new HttpError(400, 'The price must be between $0 and $1000.');
  return cents;
}

const tags = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8) : [];

devRouter.post('/dev/validate', (req, res) => {
  requireDeveloper(req);
  const errors = problems(req.body?.manifest, typeof req.body?.manifest?.id === 'string' ? req.body.manifest.id : undefined);
  res.json({ ok: errors.length === 0, errors } satisfies ValidateManifestResponse);
});

devRouter.get('/dev/plugins', (req, res) => {
  const user = requireDeveloper(req);
  const rows = sql.all<PluginRow>('SELECT * FROM plugins WHERE developer_id = ? ORDER BY updated_at DESC', user.id);
  res.json(rows.map((row) => toDevListing(row, user.id)));
});

devRouter.post('/dev/plugins', (req, res) => {
  const user = requireDeveloper(req);
  const body = (req.body ?? {}) as SaveDevPluginRequest;
  const errors = problems(body.manifest);
  if (errors.length) throw new HttpError(400, errors.join(' '));
  const manifest = body.manifest;
  if (sql.get('SELECT id FROM plugins WHERE id = ?', manifest.id)) throw new HttpError(409, `The id "${manifest.id}" is already taken.`);
  const stamp = now();
  sql.transaction(() => {
    sql.run(
      `INSERT INTO plugins (id, developer_id, name, summary, description, category, icon, tags, price_cents, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      manifest.id, user.id, manifest.name, (body.summary ?? manifest.description).slice(0, 160), manifest.description,
      manifest.category, manifest.icon, JSON.stringify(tags(body.tags)), price(body.priceCents), stamp, stamp,
    );
    sql.run(
      'INSERT INTO plugin_versions (plugin_id, version, manifest, changelog, created_at) VALUES (?, ?, ?, ?, ?)',
      manifest.id, manifest.version, JSON.stringify(manifest), (body.changelog ?? 'Initial release.').slice(0, 2000), stamp,
    );
  });
  record(req, 'plugin.create', `Created the plugin "${manifest.name}"`, { target: manifest.id });
  res.status(201).json(toDevListing(ownRow(manifest.id, user.id), user.id));
});

devRouter.put('/dev/plugins/:id', (req, res) => {
  const user = requireDeveloper(req);
  const row = ownRow(req.params.id, user.id);
  const body = (req.body ?? {}) as Partial<SaveDevPluginRequest>;
  const stamp = now();
  sql.transaction(() => {
    if (body.manifest) {
      const manifest = body.manifest;
      if (manifest?.id !== row.id) throw new HttpError(400, `The manifest id must stay "${row.id}".`);
      const errors = problems(manifest, row.id);
      if (errors.length) throw new HttpError(400, errors.join(' '));
      const current = latestVersion(row.id)!.version;
      const order = compareVersions(manifest.version, current);
      if (order < 0) throw new HttpError(400, `Version ${manifest.version} is older than the current ${current}.`);
      if (order === 0) {
        sql.run('UPDATE plugin_versions SET manifest = ? WHERE plugin_id = ? AND version = ?', JSON.stringify(manifest), row.id, current);
      } else {
        sql.run(
          'INSERT INTO plugin_versions (plugin_id, version, manifest, changelog, created_at) VALUES (?, ?, ?, ?, ?)',
          row.id, manifest.version, JSON.stringify(manifest), (body.changelog ?? '').slice(0, 2000), stamp,
        );
      }
      sql.run('UPDATE plugins SET name = ?, description = ?, category = ?, icon = ? WHERE id = ?', manifest.name, manifest.description, manifest.category, manifest.icon, row.id);
    }
    if (body.summary !== undefined) sql.run('UPDATE plugins SET summary = ? WHERE id = ?', body.summary.slice(0, 160), row.id);
    if (body.priceCents !== undefined) sql.run('UPDATE plugins SET price_cents = ? WHERE id = ?', price(body.priceCents), row.id);
    if (body.tags !== undefined) sql.run('UPDATE plugins SET tags = ? WHERE id = ?', JSON.stringify(tags(body.tags)), row.id);
    sql.run('UPDATE plugins SET updated_at = ? WHERE id = ?', stamp, row.id);
  });
  res.json(toDevListing(ownRow(row.id, user.id), user.id));
});

for (const [action, status] of [['publish', 'published'], ['unpublish', 'draft']] as const) {
  devRouter.post(`/dev/plugins/:id/${action}`, (req, res) => {
    const user = requireDeveloper(req);
    const row = ownRow(req.params.id, user.id);
    sql.run('UPDATE plugins SET status = ?, updated_at = ? WHERE id = ?', status, now(), row.id);
    record(req, `plugin.${action}`, `${action === 'publish' ? 'Published' : 'Unpublished'} the plugin "${row.name}"`, { target: row.id });
    res.json(toDevListing(ownRow(row.id, user.id), user.id));
  });
}

devRouter.delete('/dev/plugins/:id', (req, res) => {
  const user = requireDeveloper(req);
  const row = ownRow(req.params.id, user.id);
  if (sql.get('SELECT id FROM purchases WHERE plugin_id = ?', row.id))
    throw new HttpError(409, 'This plugin has been bought, so it cannot be deleted. Unpublish it instead.');
  sql.run('DELETE FROM plugins WHERE id = ?', row.id);
  record(req, 'plugin.delete', `Deleted the plugin "${row.name}"`, { target: row.id });
  res.status(204).end();
});

devRouter.get('/dev/earnings', (req, res) => {
  const user = requireDeveloper(req);
  const sales = sql.all<{ plugin_id: string; name: string; price_cents: number; developer_cents: number; created_at: string }>(
    `SELECT pu.plugin_id, p.name, pu.price_cents, pu.developer_cents, pu.created_at
     FROM purchases pu JOIN plugins p ON p.id = pu.plugin_id WHERE p.developer_id = ? ORDER BY pu.created_at DESC`,
    user.id,
  );
  const earnings: Earnings = {
    totalCents: sales.reduce((sum, s) => sum + s.developer_cents, 0),
    salesCount: sales.length,
    sales: sales.map((s) => ({ pluginId: s.plugin_id, pluginName: s.name, priceCents: s.price_cents, developerCents: s.developer_cents, createdAt: s.created_at })),
  };
  res.json(earnings);
});
