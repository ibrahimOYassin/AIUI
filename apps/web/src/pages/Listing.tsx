import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Download } from 'lucide-react';
import type { ListingDetail } from '@aiui/shared';
import { formatPrice } from '@aiui/shared';
import { api, errorMessage } from '../api';
import { Badge, Button, ErrorBox, Spinner, Stars } from '../components/ui';
import { compact, shortDate } from '../lib/format';
import { Icon, KIND_LABEL } from '../lib/icons';
import { useApp } from '../stores/app';
import { CheckoutDialog, ListingAction, useInstallActions } from './Marketplace';

export function ListingPage() {
  const { id = '' } = useParams();
  const toast = useApp((s) => s.toast);
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const detail = await api.listing(id);
      setListing(detail);
      const mine = detail.reviews?.find((r) => r.mine);
      if (mine) {
        setRating(mine.rating);
        setComment(mine.comment);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    setListing(null);
    void load();
  }, [load]);

  const actions = useInstallActions(() => void load());

  const postReview = async () => {
    if (!listing || rating < 1) return;
    setPosting(true);
    try {
      await api.review(listing.id, rating, comment.trim());
      toast('success', 'Thanks — your review was saved.');
      await load();
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  if (error) {
    return (
      <div className="page">
        <BackLink />
        <ErrorBox message={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (!listing) {
    return (
      <div className="page">
        <BackLink />
        <Spinner label="Loading plugin…" />
      </div>
    );
  }

  const hasReviewed = listing.reviews.some((r) => r.mine);

  return (
    <div className="page">
      <BackLink />
      <header className="listing-hero card card-pad">
        <span className="tile tile-xl">
          <Icon name={listing.icon} size={30} />
        </span>
        <div className="grow">
          <h1>
            {listing.name}
            {listing.official && (
              <span className="official" title="Official AIUI plugin">
                <BadgeCheck size={18} />
              </span>
            )}
          </h1>
          <p className="muted">{listing.summary}</p>
          <div className="row-center muted small wrap">
            <span>by {listing.author.name}</span>
            <span>·</span>
            <span>v{listing.version}</span>
            <span>·</span>
            <Stars value={listing.rating} size={13} />
            <span>{listing.ratingCount > 0 ? `${listing.rating.toFixed(1)} (${listing.ratingCount})` : 'No ratings yet'}</span>
            <span>·</span>
            <span className="row-center">
              <Download size={12} /> {compact(listing.downloads)} installs
            </span>
            <Badge tone="neutral">{listing.category}</Badge>
            {listing.status === 'draft' && <Badge tone="amber">Draft</Badge>}
          </div>
        </div>
        <div className="listing-buy">
          <div className={`price-lg ${listing.priceCents === 0 ? 'free' : ''}`}>{formatPrice(listing.priceCents)}</div>
          <ListingAction
            listing={listing}
            size="md"
            busy={actions.busyId === listing.id}
            onInstall={() => void actions.install(listing.id, listing.name)}
            onBuy={() => setCheckout(true)}
            onUninstall={() => void actions.uninstall(listing.id, listing.name)}
          />
          {listing.owned && listing.priceCents > 0 && <span className="muted small">You own this plugin</span>}
        </div>
      </header>

      <div className="listing-cols">
        <div className="listing-main">
          <section className="card card-pad">
            <h2>About</h2>
            <p className="prewrap">{listing.description || listing.summary}</p>
            {listing.tags.length > 0 && (
              <div className="chips">
                {listing.tags.map((t) => (
                  <span key={t} className="chip static">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="card card-pad">
            <h2>What it adds</h2>
            {listing.nodes.length === 0 && listing.connectionTypes.length === 0 && listing.templates.length === 0 && (
              <p className="muted">This plugin does not add any steps yet.</p>
            )}
            {listing.nodes.length > 0 && (
              <>
                <h4 className="sub">Steps</h4>
                <div className="adds">
                  {listing.nodes.map((n) => (
                    <div key={n.type} className="add-row">
                      <span className={`tile tile-sm kind-${n.kind}`}>
                        <Icon name={n.icon} size={15} />
                      </span>
                      <div>
                        <strong>{n.label}</strong> <Badge tone="neutral">{KIND_LABEL[n.kind] ?? n.kind}</Badge>
                        <div className="muted small">{n.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {listing.connectionTypes.length > 0 && (
              <>
                <h4 className="sub">Connections</h4>
                <div className="chips">
                  {listing.connectionTypes.map((c) => (
                    <span key={c.type} className="chip static">
                      <Icon name={c.icon} size={13} /> {c.label}
                    </span>
                  ))}
                </div>
              </>
            )}
            {listing.templates.length > 0 && (
              <>
                <h4 className="sub">Templates</h4>
                <div className="adds">
                  {listing.templates.map((t) => (
                    <div key={t.id} className="add-row">
                      <div>
                        <strong>{t.name}</strong>
                        <div className="muted small">{t.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="card card-pad">
            <h2>Reviews</h2>
            {listing.installed ? (
              <div className="review-form">
                <div className="row-center">
                  <span className="small">{hasReviewed ? 'Your rating' : 'Rate this plugin'}</span>
                  <Stars value={rating} onChange={setRating} size={20} />
                </div>
                <textarea rows={2} placeholder="What worked well? What could be better? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
                <div>
                  <Button variant="primary" size="sm" busy={posting} disabled={rating < 1} onClick={() => void postReview()}>
                    {hasReviewed ? 'Update review' : 'Post review'}
                  </Button>
                  {rating < 1 && <span className="muted small"> Choose a star rating first.</span>}
                </div>
              </div>
            ) : (
              <p className="muted small">Install this plugin to leave a review.</p>
            )}
            {listing.reviews.length === 0 && <p className="muted">No reviews yet.</p>}
            {listing.reviews.map((r, i) => (
              <div key={i} className="review">
                <div className="row-center">
                  <strong>{r.userName}</strong>
                  {r.mine && <Badge tone="accent">You</Badge>}
                  <Stars value={r.rating} size={12} />
                  <span className="muted small">{shortDate(r.createdAt)}</span>
                </div>
                {r.comment && <p>{r.comment}</p>}
              </div>
            ))}
          </section>
        </div>

        <aside className="listing-side">
          <section className="card card-pad">
            <h2>Versions</h2>
            {listing.versions.length === 0 && <p className="muted">No versions.</p>}
            {listing.versions.map((v) => (
              <div key={v.version} className="version">
                <div className="row-center">
                  <strong>v{v.version}</strong>
                  <span className="muted small">{shortDate(v.createdAt)}</span>
                </div>
                {v.changelog && <p className="muted small prewrap">{v.changelog}</p>}
              </div>
            ))}
          </section>
          <section className="card card-pad">
            <h2>Details</h2>
            <dl className="details">
              <dt>Plugin ID</dt>
              <dd>
                <code>{listing.id}</code>
              </dd>
              <dt>Updated</dt>
              <dd>{shortDate(listing.updatedAt)}</dd>
              <dt>Steps</dt>
              <dd>{listing.nodeCount}</dd>
            </dl>
          </section>
        </aside>
      </div>

      {checkout && (
        <CheckoutDialog
          listing={listing}
          onClose={() => setCheckout(false)}
          onDone={() => {
            setCheckout(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/marketplace" className="back-link">
      <ArrowLeft size={14} /> Marketplace
    </Link>
  );
}
