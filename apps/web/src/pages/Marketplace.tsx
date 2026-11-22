import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, Download, Lock, Puzzle, Search, ShieldCheck, Store } from 'lucide-react';
import type { InstalledPlugin, Listing, MarketQuery } from '@aiui/shared';
import { formatPrice } from '@aiui/shared';
import { api, errorMessage } from '../api';
import { Toggle } from '../components/FieldForm';
import { Badge, Button, EmptyState, ErrorBox, Modal, PageHeader, Spinner, Stars, Tabs } from '../components/ui';
import { compact } from '../lib/format';
import { Icon } from '../lib/icons';
import { useApp } from '../stores/app';

/** Demo checkout: records a purchase, takes no payment. */
export function CheckoutDialog({ listing, onClose, onDone }: { listing: Listing; onClose: () => void; onDone: () => void }) {
  const toast = useApp((s) => s.toast);
  const loadCatalog = useApp((s) => s.loadCatalog);
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    try {
      await api.purchase(listing.id);
      await api.install(listing.id);
      await loadCatalog();
      toast('success', `${listing.name} purchased and installed.`);
      onDone();
    } catch (err) {
      toast('error', errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Checkout"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void pay()}>
            Complete demo purchase
          </Button>
        </>
      }
    >
      <div className="demo-banner">
        <ShieldCheck size={16} />
        <span>
          <strong>Demo checkout — no payment is taken.</strong> No card is needed and no money moves. The purchase is only recorded so
          you can try paid plugins.
        </span>
      </div>
      <div className="checkout-line">
        <span className="tile">
          <Icon name={listing.icon} size={18} />
        </span>
        <div className="grow">
          <strong>{listing.name}</strong>
          <div className="muted small">by {listing.author.name}</div>
        </div>
        <strong>{formatPrice(listing.priceCents)}</strong>
      </div>
      <div className="checkout-total">
        <span>Total</span>
        <strong>{formatPrice(listing.priceCents)}</strong>
      </div>
    </Modal>
  );
}

export function useInstallActions(onChanged: () => void) {
  const toast = useApp((s) => s.toast);
  const loadCatalog = useApp((s) => s.loadCatalog);
  const askConfirm = useApp((s) => s.askConfirm);
  const [busyId, setBusyId] = useState<string | null>(null);

  const install = async (id: string, name: string) => {
    setBusyId(id);
    try {
      await api.install(id);
      await loadCatalog();
      toast('success', `${name} installed. Its steps are now in the step library.`);
      onChanged();
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const uninstall = async (id: string, name: string) => {
    const ok = await askConfirm({
      title: `Uninstall ${name}?`,
      message: 'Your projects are kept. Steps from this plugin will show "Plugin not installed" until you install it again.',
      confirmLabel: 'Uninstall',
      danger: true,
    });
    if (!ok) return;
    setBusyId(id);
    try {
      await api.uninstall(id);
      await loadCatalog();
      toast('success', `${name} uninstalled.`);
      onChanged();
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return { busyId, install, uninstall };
}

export function ListingAction({
  listing,
  busy,
  onInstall,
  onBuy,
  onUninstall,
  size = 'sm',
}: {
  listing: Listing;
  busy: boolean;
  onInstall: () => void;
  onBuy: () => void;
  onUninstall?: () => void;
  size?: 'sm' | 'md';
}) {
  if (listing.builtin) {
    return (
      <Badge tone="neutral">
        <Lock size={11} /> Built in
      </Badge>
    );
  }
  if (listing.installed) {
    return onUninstall ? (
      <Button size={size} busy={busy} onClick={onUninstall}>
        Uninstall
      </Button>
    ) : (
      <Badge tone="green">Installed</Badge>
    );
  }
  if (listing.owned || listing.priceCents === 0) {
    return (
      <Button size={size} variant="primary" busy={busy} icon={<Download size={14} />} onClick={onInstall}>
        {listing.priceCents === 0 ? 'Get' : 'Install'}
      </Button>
    );
  }
  return (
    <Button size={size} variant="primary" busy={busy} onClick={onBuy}>
      Buy {formatPrice(listing.priceCents)}
    </Button>
  );
}

export function MarketplacePage({ tab }: { tab: 'browse' | 'installed' }) {
  const navigate = useNavigate();
  return (
    <div className="page">
      <PageHeader title="Marketplace" subtitle="Add new steps, connections and templates to the IDE. Free and paid plugins from AIUI and independent developers." />
      <Tabs
        tabs={[
          { id: 'browse', label: 'Browse' },
          { id: 'installed', label: 'My plugins' },
        ]}
        value={tab}
        onChange={(id) => navigate(id === 'browse' ? '/marketplace' : '/marketplace/installed')}
      />
      {tab === 'browse' ? <Browse /> : <Installed />}
    </div>
  );
}

function Browse() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [price, setPrice] = useState<MarketQuery['price']>();
  const [sort, setSort] = useState<NonNullable<MarketQuery['sort']>>('popular');
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<Listing | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.listings({ q: debounced || undefined, category, price, sort });
      setListings(result);
      if (!debounced && !category && !price) {
        setCategories([...new Set(result.map((l) => l.category))].sort());
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [debounced, category, price, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useInstallActions(() => void load());
  const filtered = !!(debounced || category || price);

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={15} />
          <input placeholder="Search plugins…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="segmented">
          {([undefined, 'free', 'paid'] as const).map((p) => (
            <button key={p ?? 'all'} type="button" className={price === p ? 'active' : ''} onClick={() => setPrice(p)}>
              {p === undefined ? 'All' : p === 'free' ? 'Free' : 'Paid'}
            </button>
          ))}
        </div>
        <span className="grow" />
        <label className="muted small">Sort by</label>
        <select className="select-sm" value={sort} onChange={(e) => setSort(e.target.value as NonNullable<MarketQuery['sort']>)}>
          <option value="popular">Most popular</option>
          <option value="new">Newest</option>
          <option value="rating">Highest rated</option>
        </select>
      </div>
      {categories.length > 0 && (
        <div className="chips">
          <button type="button" className={`chip ${!category ? 'active' : ''}`} onClick={() => setCategory(undefined)}>
            All categories
          </button>
          {categories.map((c) => (
            <button key={c} type="button" className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(category === c ? undefined : c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!error && listings === null && <Spinner label="Loading plugins…" />}
      {listings && listings.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<Store size={24} />}
            title={filtered ? 'No plugins match' : 'The marketplace is empty'}
            action={
              filtered ? (
                <Button
                  onClick={() => {
                    setQ('');
                    setCategory(undefined);
                    setPrice(undefined);
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button onClick={() => navigate('/developer')}>Publish the first plugin</Button>
              )
            }
          >
            {filtered ? 'Try a different search or remove a filter.' : 'Nothing has been published yet.'}
          </EmptyState>
        </div>
      )}
      {listings && listings.length > 0 && (
        <div className="grid cards">
          {listings.map((l) => (
            <article key={l.id} className="card listing-card" onClick={() => navigate(`/marketplace/plugin/${encodeURIComponent(l.id)}`)}>
              <div className="listing-top">
                <span className="tile">
                  <Icon name={l.icon} size={20} />
                </span>
                <div className="grow">
                  <h3>
                    {l.name}
                    {l.official && (
                      <span className="official" title="Official AIUI plugin">
                        <BadgeCheck size={15} />
                      </span>
                    )}
                  </h3>
                  <div className="muted small">by {l.author.name}</div>
                </div>
                <strong className={l.priceCents === 0 ? 'price free' : 'price'}>{formatPrice(l.priceCents)}</strong>
              </div>
              <p className="muted clamp-2">{l.summary}</p>
              <div className="listing-foot">
                <span className="row-center muted small">
                  <Stars value={l.rating} size={12} />
                  {l.ratingCount > 0 ? `${l.rating.toFixed(1)} (${l.ratingCount})` : 'No ratings'}
                </span>
                <span className="row-center muted small">
                  <Download size={12} /> {compact(l.downloads)}
                </span>
                <span className="grow" />
                <span onClick={(e) => e.stopPropagation()}>
                  <ListingAction
                    listing={l}
                    busy={actions.busyId === l.id}
                    onInstall={() => void actions.install(l.id, l.name)}
                    onBuy={() => setCheckout(l)}
                  />
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
      {checkout && (
        <CheckoutDialog
          listing={checkout}
          onClose={() => setCheckout(null)}
          onDone={() => {
            setCheckout(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function Installed() {
  const plugins = useApp((s) => s.catalog.plugins);
  const loadCatalog = useApp((s) => s.loadCatalog);
  const toast = useApp((s) => s.toast);
  const actions = useInstallActions(() => undefined);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const sorted = useMemo(() => [...plugins].sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name)), [plugins]);

  const setEnabled = async (p: InstalledPlugin, enabled: boolean) => {
    setBusy(p.id);
    try {
      await api.setEnabled(p.id, enabled);
      await loadCatalog();
      toast('success', `${p.name} ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const update = async (p: InstalledPlugin) => {
    setBusy(p.id);
    try {
      await api.install(p.id);
      await loadCatalog();
      toast('success', `${p.name} updated to ${p.latestVersion}.`);
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (sorted.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={<Puzzle size={24} />} title="No plugins installed" action={<Link className="btn btn-primary btn-md" to="/marketplace">Browse the Marketplace</Link>}>
          Plugins add steps to the step library.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="card list">
      {sorted.map((p) => (
        <div key={p.id} className={`list-row ${p.enabled ? '' : 'dim'}`}>
          <span className="tile">
            <Icon name={p.icon} size={18} />
          </span>
          <div className="list-main">
            <strong>
              <Link to={`/marketplace/plugin/${encodeURIComponent(p.id)}`}>{p.name}</Link>{' '}
              <span className="muted small">v{p.version}</span>
            </strong>
            <span className="muted small ellipsis">
              {p.description} · {p.nodeCount} step{p.nodeCount === 1 ? '' : 's'} · by {p.author}
            </span>
          </div>
          {p.latestVersion && p.latestVersion !== p.version && (
            <Button size="sm" busy={busy === p.id} onClick={() => void update(p)}>
              Update to {p.latestVersion}
            </Button>
          )}
          {p.builtin ? (
            <Badge tone="neutral">
              <Lock size={11} /> Built in
            </Badge>
          ) : (
            <>
              <label className="row-center small muted" title={p.enabled ? 'Disable to hide its steps' : 'Enable to show its steps'}>
                {p.enabled ? 'Enabled' : 'Disabled'}
                <Toggle checked={p.enabled} disabled={busy === p.id} onChange={(v) => void setEnabled(p, v)} />
              </label>
              <Button size="sm" busy={actions.busyId === p.id} onClick={() => void actions.uninstall(p.id, p.name)}>
                Uninstall
              </Button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
