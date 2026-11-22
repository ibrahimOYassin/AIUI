import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Pencil, Plug, PlugZap, Plus, Trash2, XCircle } from 'lucide-react';
import type { Connection, TestConnectionResult } from '@aiui/shared';
import { api, errorMessage } from '../api';
import { Button, EmptyState, PageHeader } from '../components/ui';
import { timeAgo } from '../lib/format';
import { Icon } from '../lib/icons';
import { useApp } from '../stores/app';

export function ConnectionsPage() {
  const connections = useApp((s) => s.connections);
  const types = useApp((s) => s.catalog.connectionTypes);
  const load = useApp((s) => s.loadConnections);
  const openDialog = useApp((s) => s.openConnectionDialog);
  const askConfirm = useApp((s) => s.askConfirm);
  const toast = useApp((s) => s.toast);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestConnectionResult>>({});

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, Connection[]>();
    for (const c of connections) map.set(c.type, [...(map.get(c.type) ?? []), c]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [connections]);

  const test = async (c: Connection) => {
    setTesting(c.id);
    try {
      const result = await api.testConnection(c.id);
      setResults((r) => ({ ...r, [c.id]: result }));
    } catch (err) {
      setResults((r) => ({ ...r, [c.id]: { ok: false, message: errorMessage(err) } }));
    } finally {
      setTesting(null);
    }
  };

  const remove = async (c: Connection) => {
    const ok = await askConfirm({
      title: 'Delete connection?',
      message: `Steps that use "${c.name}" will stop working until you choose another connection.`,
      confirmLabel: 'Delete connection',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteConnection(c.id);
      toast('success', 'Connection deleted.');
      void load();
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Connections"
        subtitle="Save an AI model, mail server, API or MCP server once, then pick it in any step. Secrets are encrypted."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => void openDialog()}>
            New connection
          </Button>
        }
      />

      {connections.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<Plug size={24} />}
            title="No connections yet"
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => void openDialog()}>
                New connection
              </Button>
            }
          >
            Start with an AI model: a hosted provider with an API key, or a model running on your own computer.
          </EmptyState>
        </div>
      )}

      {types.length > 0 && connections.length === 0 && (
        <>
          <h2 className="section-title">What you can connect</h2>
          <div className="grid cards">
            {types.map((t) => (
              <article key={t.type} className="card template-card" onClick={() => void openDialog({ type: t.type })}>
                <span className="tile">
                  <Icon name={t.icon} size={18} />
                </span>
                <div>
                  <h3>{t.label}</h3>
                  <p className="muted clamp-2">{t.description}</p>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {groups.map(([typeId, list]) => {
        const type = types.find((t) => t.type === typeId);
        return (
          <section key={typeId} className="conn-group">
            <h2 className="section-title">
              <Icon name={type?.icon ?? 'plug'} size={16} /> {type?.label ?? typeId}
              {!type && (
                <span className="muted small">
                  {' '}
                  — plugin not installed. <Link to="/marketplace">Open Marketplace</Link>
                </span>
              )}
            </h2>
            <div className="card list">
              {list.map((c) => {
                const result = results[c.id];
                const summary = type?.fields
                  .filter((f) => f.type !== 'secret' && c.values[f.key] !== undefined && c.values[f.key] !== '')
                  .slice(0, 2)
                  .map((f) => String(c.values[f.key]))
                  .join(' · ');
                return (
                  <div key={c.id} className="list-row">
                    <div className="list-main">
                      <strong>{c.name}</strong>
                      <span className="muted small ellipsis">{summary || 'No details'}</span>
                      {result && (
                        <span className={`test-inline ${result.ok ? 'ok' : 'fail'}`}>
                          {result.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                          {result.message || (result.ok ? 'Connection works.' : 'Connection failed.')}
                        </span>
                      )}
                    </div>
                    <span className="muted small nowrap">Added {timeAgo(c.createdAt)}</span>
                    <Button size="sm" icon={<PlugZap size={14} />} busy={testing === c.id} onClick={() => void test(c)}>
                      Test
                    </Button>
                    <Button size="sm" icon={<Pencil size={14} />} disabled={!type} onClick={() => void openDialog({ connection: c })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => void remove(c)} aria-label="Delete" />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
