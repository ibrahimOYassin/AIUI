import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Code2, DollarSign, Pencil, Plus, Rocket, Trash2 } from 'lucide-react';
import type { DevListing, Earnings } from '@aiui/shared';
import { formatPrice } from '@aiui/shared';
import { api, errorMessage } from '../api';
import { Badge, Button, EmptyState, ErrorBox, PageHeader, Spinner, Tabs } from '../components/ui';
import { compact, shortDate } from '../lib/format';
import { Icon } from '../lib/icons';
import { useApp } from '../stores/app';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function DeveloperPage() {
  const user = useApp((s) => s.user)!;
  const isDeveloper = user.roles.includes('developer');
  return (
    <div className="page">
      <PageHeader
        title="Developer portal"
        subtitle="Publish plugins that add steps, connections and templates to AIUI — free or paid."
        actions={
          isDeveloper ? (
            <Link className="btn btn-primary btn-md" to="/developer/new">
              <Plus size={16} />
              <span>New plugin</span>
            </Link>
          ) : undefined
        }
      />
      {isDeveloper ? <Portal /> : <BecomeDeveloper />}
    </div>
  );
}

function BecomeDeveloper() {
  const user = useApp((s) => s.user)!;
  const setUser = useApp((s) => s.setUser);
  const toast = useApp((s) => s.toast);
  const [developerName, setDeveloperName] = useState(user.name);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    try {
      const updated = await api.updateMe({ becomeDeveloper: true, developerName: developerName.trim() });
      setUser(updated);
      toast('success', 'You are now a developer. Create your first plugin.');
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad become">
      <span className="tile tile-xl">
        <Code2 size={28} />
      </span>
      <div>
        <h2>Become a developer</h2>
        <p className="muted">
          Developers publish plugins to the Marketplace. A plugin is a description of steps plus the Python and C# code each step
          generates. You keep 80% of every sale; free plugins are welcome too.
        </p>
        <ul className="ticks">
          <li>Uses your existing account — nothing new to sign up for</li>
          <li>Set a price or publish for free</li>
          <li>Track installs and earnings</li>
        </ul>
        <div className="field" style={{ maxWidth: 360 }}>
          <div className="field-label">
            <label>Developer name</label>
          </div>
          <input type="text" value={developerName} onChange={(e) => setDeveloperName(e.target.value)} />
          <div className="field-help">Shown as the author on your listings. You can change it later.</div>
        </div>
        <Button variant="primary" icon={<Rocket size={16} />} busy={busy} disabled={!developerName.trim()} onClick={() => void join()}>
          Become a developer
        </Button>
      </div>
    </div>
  );
}

function Portal() {
  const [tab, setTab] = useState<'plugins' | 'earnings'>('plugins');
  return (
    <>
      <Tabs
        tabs={[
          { id: 'plugins', label: 'My plugins' },
          { id: 'earnings', label: 'Earnings' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'plugins' ? <MyPlugins /> : <EarningsTab />}
    </>
  );
}

function MyPlugins() {
  const navigate = useNavigate();
  const toast = useApp((s) => s.toast);
  const askConfirm = useApp((s) => s.askConfirm);
  const loadCatalog = useApp((s) => s.loadCatalog);
  const [plugins, setPlugins] = useState<DevListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPlugins(await api.devPlugins());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePublish = async (p: DevListing) => {
    setBusy(p.id);
    try {
      if (p.status === 'published') {
        await api.devUnpublish(p.id);
        toast('success', `${p.name} is no longer listed.`);
      } else {
        await api.devPublish(p.id);
        toast('success', `${p.name} is now live in the Marketplace.`);
      }
      await Promise.all([load(), loadCatalog()]);
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (p: DevListing) => {
    const ok = await askConfirm({
      title: `Delete ${p.name}?`,
      message: 'The listing and all of its versions are removed from the Marketplace. People who installed it lose its steps.',
      confirmLabel: 'Delete plugin',
      danger: true,
    });
    if (!ok) return;
    setBusy(p.id);
    try {
      await api.devDelete(p.id);
      toast('success', 'Plugin deleted.');
      await Promise.all([load(), loadCatalog()]);
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!plugins) return <Spinner label="Loading your plugins…" />;
  if (plugins.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<Code2 size={24} />}
          title="Publish your first plugin"
          action={
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/developer/new?example=1')}>
              Start from an example
            </Button>
          }
        >
          The editor comes with a working example you can change and publish in a few minutes.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Plugin</th>
            <th>Status</th>
            <th>Version</th>
            <th>Price</th>
            <th className="num">Installs</th>
            <th className="num">Sales</th>
            <th className="num">Earnings</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {plugins.map((p) => (
            <tr key={p.id}>
              <td>
                <div className="row-center">
                  <span className="tile tile-sm">
                    <Icon name={p.icon} size={15} />
                  </span>
                  <div>
                    <strong>{p.name}</strong>
                    <div className="muted small">
                      <code>{p.id}</code>
                    </div>
                  </div>
                </div>
              </td>
              <td>{p.status === 'published' ? <Badge tone="green">Published</Badge> : <Badge tone="amber">Draft</Badge>}</td>
              <td>v{p.version}</td>
              <td>{formatPrice(p.priceCents)}</td>
              <td className="num">{compact(p.downloads)}</td>
              <td className="num">{p.salesCount}</td>
              <td className="num">{money(p.earningsCents)}</td>
              <td>
                <div className="row-center end">
                  <Button size="sm" variant={p.status === 'published' ? 'default' : 'primary'} busy={busy === p.id} onClick={() => void togglePublish(p)}>
                    {p.status === 'published' ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button size="sm" icon={<Pencil size={14} />} onClick={() => navigate(`/developer/edit/${encodeURIComponent(p.id)}`)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => void remove(p)} aria-label="Delete" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EarningsTab() {
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setEarnings(await api.devEarnings());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!earnings) return <Spinner label="Loading earnings…" />;
  const sales = earnings.sales ?? [];

  return (
    <>
      <div className="stats">
        <div className="card stat">
          <span className="muted small">Total earnings</span>
          <strong>{money(earnings.totalCents)}</strong>
          <span className="muted small">Your 80% share</span>
        </div>
        <div className="card stat">
          <span className="muted small">Sales</span>
          <strong>{earnings.salesCount}</strong>
          <span className="muted small">Paid purchases</span>
        </div>
      </div>
      <div className="demo-banner">
        <DollarSign size={16} />
        <span>Checkout is in demo mode: purchases are recorded but no money moves, so these figures are for illustration.</span>
      </div>
      {sales.length === 0 ? (
        <div className="card">
          <EmptyState icon={<DollarSign size={24} />} title="No sales yet">
            Sales of your paid plugins will appear here, one line per purchase.
          </EmptyState>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Plugin</th>
                <th className="num">Price</th>
                <th className="num">Your share</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s, i) => (
                <tr key={i}>
                  <td>{shortDate(s.createdAt)}</td>
                  <td>{s.pluginName}</td>
                  <td className="num">{money(s.priceCents)}</td>
                  <td className="num">{money(s.developerCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
