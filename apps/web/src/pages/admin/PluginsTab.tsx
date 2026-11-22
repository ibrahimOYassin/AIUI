import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, ExternalLink, Puzzle, Search, Trash2 } from 'lucide-react';
import type { AdminPlugin } from '@aiui/shared';
import { formatPrice } from '@aiui/shared';
import { api, errorMessage } from '../../api';
import { Badge, Button, EmptyState, ErrorBox, Spinner } from '../../components/ui';
import { Icon } from '../../lib/icons';
import { useApp } from '../../stores/app';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function PluginsTab() {
  const toast = useApp((s) => s.toast);
  const askConfirm = useApp((s) => s.askConfirm);
  const loadCatalog = useApp((s) => s.loadCatalog);
  const [plugins, setPlugins] = useState<AdminPlugin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      setPlugins(await api.adminPlugins());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = plugins ?? [];
    const filtered = needle ? list.filter((p) => `${p.name} ${p.id} ${p.author.name} ${p.developerEmail}`.toLowerCase().includes(needle)) : list;
    return [...filtered].sort((a, b) => b.downloads - a.downloads || a.name.localeCompare(b.name));
  }, [plugins, q]);

  const change = async (p: AdminPlugin, key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(`${p.id}:${key}`);
    try {
      await fn();
      toast('success', done);
      await Promise.all([load(), loadCatalog()]);
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (p: AdminPlugin) => {
    const ok = await askConfirm({
      title: `Delete ${p.name}?`,
      message: `The listing and all of its versions are removed from the Marketplace. ${p.downloads > 0 ? `${p.downloads} install${p.downloads === 1 ? '' : 's'} will lose its steps.` : 'Nobody has installed it yet.'} This cannot be undone.`,
      confirmLabel: 'Delete plugin',
      danger: true,
    });
    if (!ok) return;
    await change(p, 'delete', () => api.adminDeletePlugin(p.id), `${p.name} was deleted.`);
  };

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!plugins) return <Spinner label="Loading plugins…" />;
  if (plugins.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={<Puzzle size={24} />} title="No plugins yet">
          Plugins published by developers appear here for review.
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={15} />
          <input placeholder="Search plugins or developers…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="grow" />
        <span className="muted small">
          {shown.length} of {plugins.length} plugin{plugins.length === 1 ? '' : 's'}
        </span>
      </div>
      {shown.length === 0 ? (
        <div className="card">
          <EmptyState title="No plugin matches" action={<Button onClick={() => setQ('')}>Clear search</Button>}>
            Try a different name.
          </EmptyState>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Plugin</th>
                <th>Developer</th>
                <th>Status</th>
                <th>Price</th>
                <th className="num">Installs</th>
                <th className="num">Sales</th>
                <th className="num">Revenue</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const published = p.status === 'published';
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="row-center">
                        <span className="tile tile-sm">
                          <Icon name={p.icon} size={15} />
                        </span>
                        <div>
                          <strong>{p.name}</strong>{' '}
                          {p.official && (
                            <span className="official" title="Official plugin">
                              <BadgeCheck size={14} />
                            </span>
                          )}
                          <div className="muted small">
                            <code>{p.id}</code> · v{p.version}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {p.author.name}
                      <div className="muted small">{p.developerEmail}</div>
                    </td>
                    <td>
                      <span className="row-center">
                        {published ? <Badge tone="green">Published</Badge> : <Badge tone="amber">Draft</Badge>}
                        {p.official && <Badge tone="blue">Official</Badge>}
                        {p.builtin && <Badge tone="neutral">Built in</Badge>}
                      </span>
                    </td>
                    <td>{formatPrice(p.priceCents)}</td>
                    <td className="num">{p.downloads.toLocaleString()}</td>
                    <td className="num">{p.salesCount.toLocaleString()}</td>
                    <td className="num">{money(p.revenueCents)}</td>
                    <td>
                      <div className="row-center end">
                        <Button
                          size="sm"
                          busy={busy === `${p.id}:status`}
                          disabled={busy !== null || (p.builtin && published)}
                          title={p.builtin && published ? 'Built-in plugins are part of the IDE and stay published.' : undefined}
                          onClick={() =>
                            void change(
                              p,
                              'status',
                              () => api.adminUpdatePlugin(p.id, { status: published ? 'draft' : 'published' }),
                              published ? `${p.name} is no longer listed.` : `${p.name} is now listed in the Marketplace.`,
                            )
                          }
                        >
                          {published ? 'Unpublish' : 'Publish'}
                        </Button>
                        <Button
                          size="sm"
                          busy={busy === `${p.id}:official`}
                          disabled={busy !== null}
                          onClick={() =>
                            void change(
                              p,
                              'official',
                              () => api.adminUpdatePlugin(p.id, { official: !p.official }),
                              p.official ? `${p.name} is no longer marked official.` : `${p.name} is now marked official.`,
                            )
                          }
                        >
                          {p.official ? 'Remove official' : 'Mark official'}
                        </Button>
                        <Link to={`/marketplace/plugin/${encodeURIComponent(p.id)}`} className="icon-btn" title="Open the Marketplace listing" aria-label="Open the Marketplace listing">
                          <ExternalLink size={15} />
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 size={14} />}
                          disabled={busy !== null || p.builtin}
                          onClick={() => void remove(p)}
                          aria-label={`Delete ${p.name}`}
                          title={p.builtin ? 'Built-in plugins cannot be deleted.' : 'Delete plugin'}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
