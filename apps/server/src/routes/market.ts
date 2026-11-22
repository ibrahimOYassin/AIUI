import crypto from 'node:crypto';
import { Router } from 'express';
import type { Listing, ListingDetail, MarketQuery, PluginManifest, Review } from '@aiui/shared';
import { config } from '../config.ts';
import { now, sql } from '../db.ts';
import { HttpError, currentUser, requireAuth } from '../http.ts';
import { record } from '../platform.ts';
import { buildCatalog, latestVersion } from '../plugins.ts';

export const marketRouter = Router();
marketRouter.use(requireAuth);

export interface PluginRow {
  id: string;
  developer_id: string;
  name: string;
  summary: string;
  description: string;
  category: string;
  icon: string;
  tags: string;
  price_cents: number;
  status: 'draft' | 'published';
  official: number;
  builtin: number;
  downloads: number;
  created_at: string;
  updated_at: string;
}

export function isOwned(row: PluginRow, userId: string): boolean {
  if (row.price_cents === 0 || row.developer_id === userId) return true;
  return !!sql.get('SELECT id FROM purchases WHERE user_id = ? AND plugin_id = ?', userId, row.id);
}

export function toListing(row: PluginRow, userId: string, manifest?: PluginManifest): Listing {
  const latest = manifest ? { version: manifest.version, manifest } : latestVersion(row.id);
  const author = sql.get<{ name: string; developer_name: string | null }>('SELECT name, developer_name FROM users WHERE id = ?', row.developer_id);
  const rating = sql.get<{ average: number | null; count: number }>('SELECT AVG(rating) AS average, COUNT(*) AS count FROM reviews WHERE plugin_id = ?', row.id);
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    category: row.category,
    icon: row.icon,
    tags: JSON.parse(row.tags) as string[],
    author: { id: row.developer_id, name: author?.developer_name ?? author?.name ?? 'Unknown' },
    version: latest?.version ?? '0.0.0',
    priceCents: row.price_cents,
    currency: 'USD',
    downloads: row.downloads,
    rating: rating?.average ? Math.round(rating.average * 10) / 10 : 0,
    ratingCount: rating?.count ?? 0,
    status: row.status,
    official: row.official === 1,
    builtin: row.builtin === 1,
    nodeCount: latest?.manifest.nodes.length ?? 0,
    updatedAt: row.updated_at,
    owned: isOwned(row, userId),
    installed: row.builtin === 1 || !!sql.get('SELECT plugin_id FROM installs WHERE user_id = ? AND plugin_id = ?', userId, row.id),
  };
}

/** A listing the user may see: published, or their own draft. */
function visibleRow(id: string, userId: string): PluginRow {
  const row = sql.get<PluginRow>('SELECT * FROM plugins WHERE id = ?', id);
  if (!row || (row.status !== 'published' && row.developer_id !== userId)) throw new HttpError(404, 'Plugin not found.');
  return row;
}

marketRouter.get('/market/plugins', (req, res) => {
  const user = currentUser(req);
  const query = req.query as MarketQuery;
  const search = (query.q ?? '').toString().trim().toLowerCase();
  let listings = sql.all<PluginRow>("SELECT * FROM plugins WHERE status = 'published'").map((row) => toListing(row, user.id));
  if (search) {
    listings = listings.filter((l) =>
      [l.name, l.summary, l.category, l.author.name, ...l.tags].some((value) => value.toLowerCase().includes(search)));
  }
  if (query.category) listings = listings.filter((l) => l.category === query.category);
  if (query.price === 'free') listings = listings.filter((l) => l.priceCents === 0);
  if (query.price === 'paid') listings = listings.filter((l) => l.priceCents > 0);
  const sorters: Record<string, (a: Listing, b: Listing) => number> = {
    popular: (a, b) => b.downloads - a.downloads || a.name.localeCompare(b.name),
    new: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    rating: (a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount,
  };
  res.json(listings.sort(sorters[query.sort ?? 'popular'] ?? sorters.popular));
});

marketRouter.get('/market/plugins/:id', (req, res) => {
  const user = currentUser(req);
  const row = visibleRow(req.params.id, user.id);
  const latest = latestVersion(row.id);
  if (!latest) throw new HttpError(404, 'Plugin not found.');
  const { manifest } = latest;
  const reviews = sql.all<{ user_id: string; rating: number; comment: string; created_at: string; name: string }>(
    'SELECT r.user_id, r.rating, r.comment, r.created_at, u.name FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.plugin_id = ? ORDER BY r.created_at DESC',
    row.id,
  );
  const detail: ListingDetail = {
    ...toListing(row, user.id, manifest),
    description: row.description,
    // Step source is deliberately left out: it is only used server-side, after install.
    nodes: manifest.nodes.map((n) => ({ type: n.type, label: n.label, description: n.description, icon: n.icon, kind: n.kind })),
    connectionTypes: (manifest.connectionTypes ?? []).map((c) => ({ type: c.type, label: c.label, icon: c.icon })),
    templates: (manifest.templates ?? []).map((t) => ({ id: t.id, name: t.name, description: t.description })),
    versions: sql.all<{ version: string; changelog: string; created_at: string }>(
      'SELECT version, changelog, created_at FROM plugin_versions WHERE plugin_id = ? ORDER BY created_at DESC', row.id,
    ).map((v) => ({ version: v.version, changelog: v.changelog, createdAt: v.created_at })),
    reviews: reviews.map((r): Review => ({ userName: r.name, rating: r.rating, comment: r.comment, createdAt: r.created_at, mine: r.user_id === user.id })),
  };
  res.json(detail);
});

/**
 * Buying a paid plugin. Payment is simulated in this MVP: the purchase is recorded and
 * the developer's share is booked, but no money moves. A real payment provider plugs in here.
 */
marketRouter.post('/market/plugins/:id/purchase', (req, res) => {
  const user = currentUser(req);
  const row = visibleRow(req.params.id, user.id);
  if (row.status !== 'published') throw new HttpError(400, 'This plugin is not published yet.');
  if (!isOwned(row, user.id)) {
    sql.run(
      'INSERT INTO purchases (id, user_id, plugin_id, price_cents, developer_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), user.id, row.id, row.price_cents, Math.round(row.price_cents * config.developerShare), now(),
    );
    record(req, 'plugin.purchase', `Bought the plugin "${row.name}" for $${(row.price_cents / 100).toFixed(2)}`, { target: row.id });
  }
  res.json({ ok: true });
});

marketRouter.post('/market/plugins/:id/install', (req, res) => {
  const user = currentUser(req);
  const row = visibleRow(req.params.id, user.id);
  if (row.builtin === 1) return void res.json({ ok: true });
  if (!isOwned(row, user.id)) throw new HttpError(402, 'Buy this plugin before installing it.');
  const latest = latestVersion(row.id);
  if (!latest) throw new HttpError(404, 'Plugin not found.');
  const existing = sql.get('SELECT plugin_id FROM installs WHERE user_id = ? AND plugin_id = ?', user.id, row.id);
  sql.run(
    `INSERT INTO installs (user_id, plugin_id, version, enabled, created_at) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (user_id, plugin_id) DO UPDATE SET version = excluded.version, enabled = 1`,
    user.id, row.id, latest.version, now(),
  );
  if (!existing) {
    sql.run('UPDATE plugins SET downloads = downloads + 1 WHERE id = ?', row.id);
    record(req, 'plugin.install', `Installed the plugin "${row.name}"`, { target: row.id });
  }
  res.json({ ok: true, version: latest.version });
});

marketRouter.delete('/market/plugins/:id/install', (req, res) => {
  const user = currentUser(req);
  const row = sql.get<PluginRow>('SELECT * FROM plugins WHERE id = ?', req.params.id);
  if (row?.builtin === 1) throw new HttpError(400, 'Core plugins cannot be removed.');
  if (sql.get('SELECT plugin_id FROM installs WHERE user_id = ? AND plugin_id = ?', user.id, req.params.id)) {
    sql.run('DELETE FROM installs WHERE user_id = ? AND plugin_id = ?', user.id, req.params.id);
    record(req, 'plugin.uninstall', `Removed the plugin "${row?.name ?? req.params.id}"`, { target: req.params.id });
  }
  res.status(204).end();
});

marketRouter.post('/market/plugins/:id/reviews', (req, res) => {
  const user = currentUser(req);
  const row = visibleRow(req.params.id, user.id);
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Choose a rating from 1 to 5.');
  if (row.developer_id === user.id) throw new HttpError(400, 'You cannot review your own plugin.');
  const installed = row.builtin === 1 || sql.get('SELECT plugin_id FROM installs WHERE user_id = ? AND plugin_id = ?', user.id, row.id);
  if (!installed) throw new HttpError(400, 'Install the plugin before reviewing it.');
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 2000) : '';
  sql.run(
    `INSERT INTO reviews (user_id, plugin_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, plugin_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = excluded.created_at`,
    user.id, row.id, rating, comment, now(),
  );
  res.json({ ok: true });
});

marketRouter.get('/market/installed', (req, res) => {
  res.json(buildCatalog(currentUser(req).id).plugins);
});

marketRouter.patch('/market/installed/:id', (req, res) => {
  const user = currentUser(req);
  if (typeof req.body?.enabled !== 'boolean') throw new HttpError(400, '"enabled" must be true or false.');
  const install = sql.get('SELECT plugin_id FROM installs WHERE user_id = ? AND plugin_id = ?', user.id, req.params.id);
  if (!install) throw new HttpError(404, 'That plugin is not installed (core plugins are always on).');
  sql.run('UPDATE installs SET enabled = ? WHERE user_id = ? AND plugin_id = ?', req.body.enabled ? 1 : 0, user.id, req.params.id);
  res.json({ ok: true });
});
