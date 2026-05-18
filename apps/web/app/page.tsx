'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { CATEGORIES, type CategoryKey, ALL_CATEGORY_KEYS } from '@/lib/categories';
import { placeholderFor } from '@/lib/icons';
import { Logo } from './Logo';
import { AdSlot } from './AdSlot';

const AD_SLOT_TOP = process.env.NEXT_PUBLIC_ADSENSE_SLOT_TOP;
const AD_SLOT_INFEED = process.env.NEXT_PUBLIC_ADSENSE_SLOT_INFEED;
const AD_EVERY_N_CARDS = 6;

interface Activity {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  timezone: string | null;
  venueName: string | null;
  city: string | null;
  region: string | null;
  ageRange: { min: number | null; max: number | null; label: string } | null;
  costMinCents: number | null;
  costMaxCents: number | null;
  currency: string | null;
  availability: string;
  url: string | null;
  imageUrl: string | null;
  canonicalCategories: CategoryKey[];
  distanceMeters: number | null;
  ratingAverage: number | null;
  ratingCount: number;
  organizer: {
    name: string | null;
    url: string | null;
    key: string;
    ratingAverage: number | null;
    ratingCount: number;
  } | null;
}

type GeoState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; lat: number; lng: number }
  | { kind: 'denied' }
  | { kind: 'unsupported' };

const STORAGE_ONBOARDED = 'proactivity:onboarded:v1';
const STORAGE_INTERESTS = 'proactivity:interests:v1';

export default function HomePage() {
  const [geo, setGeo] = useState<GeoState>({ kind: 'idle' });
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    radiusKm: 25,
    dateRange: '7' as '1' | '2' | '7' | '14' | '30' | 'all' | 'past',
    sort: 'time' as 'distance' | 'time' | 'cost',
    freeOnly: false,
    includeUnavailable: false,
  });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<CategoryKey>>(new Set());
  // Site-wide popularity order, fetched once and frozen for the session so
  // chips don't shuffle as you click.
  const [orderedCategories, setOrderedCategories] = useState<CategoryKey[]>([...ALL_CATEGORY_KEYS]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<Activity | null>(null);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [me, setMe] = useState<{ id: string; email: string; name: string | null } | null>(null);
  const [noAds, setNoAds] = useState(false);

  // Fetch current user + subscription state once on mount.
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : { user: null, subscription: null }))
      .then((d: { user: typeof me; subscription: { noAds: boolean } | null }) => {
        setMe(d.user);
        setNoAds(d.subscription?.noAds === true);
      })
      .catch(() => { /* not signed in */ });
  }, []);

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setMe(null);
  };

  // Fetch site-wide popularity once on mount.
  useEffect(() => {
    fetch('/api/categories/popular')
      .then((r) => (r.ok ? r.json() : { ordered: [] }))
      .then((d: { ordered?: CategoryKey[] }) => {
        if (d.ordered && d.ordered.length > 0) setOrderedCategories(d.ordered);
      })
      .catch(() => {
        /* keep default order */
      });
  }, []);

  // Onboarding check + pre-fill saved interests.
  useEffect(() => {
    try {
      const onboarded = localStorage.getItem(STORAGE_ONBOARDED);
      const interestsRaw = localStorage.getItem(STORAGE_INTERESTS);
      if (onboarded === '1') {
        if (interestsRaw) {
          const arr = JSON.parse(interestsRaw) as CategoryKey[];
          if (Array.isArray(arr) && arr.length > 0) {
            setActiveCategories(new Set(arr.filter((k) => (ALL_CATEGORY_KEYS as readonly string[]).includes(k))));
          }
        }
      } else {
        setShowOnboarding(true);
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const completeOnboarding = (skip: boolean) => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(STORAGE_ONBOARDED, '1');
      if (!skip) {
        localStorage.setItem(STORAGE_INTERESTS, JSON.stringify([...activeCategories]));
      }
    } catch {
      /* ignore */
    }
  };
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Geolocation on mount.
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeo({ kind: 'unsupported' });
      return;
    }
    setGeo({ kind: 'loading' });
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ kind: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGeo({ kind: 'denied' }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  // Reverse-geocode once location is known.
  useEffect(() => {
    if (geo.kind !== 'ok') return;
    let cancelled = false;
    fetch(`/api/geocode/reverse?lat=${geo.lat}&lng=${geo.lng}`)
      .then((r) => (r.ok ? r.json() : { name: '' }))
      .then((d: { name?: string }) => {
        if (!cancelled && d.name) setPlaceName(d.name);
      })
      .catch(() => {
        /* silent — fall back to coords */
      });
    return () => {
      cancelled = true;
    };
  }, [geo]);

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (geo.kind === 'ok') {
      p.set('lat', String(geo.lat));
      p.set('lng', String(geo.lng));
    }
    p.set('radiusKm', String(filters.radiusKm));
    p.set('daysAhead', filters.dateRange);
    p.set('sort', filters.sort);
    if (filters.freeOnly) p.set('freeOnly', '1');
    if (filters.includeUnavailable) p.set('includeUnavailable', '1');
    if (debouncedSearch) p.set('search', debouncedSearch);
    if (activeCategories.size > 0) p.set('category', [...activeCategories].join(','));
    return p.toString();
  }, [geo, filters, debouncedSearch, activeCategories]);

  useEffect(() => {
    if (geo.kind === 'idle' || geo.kind === 'loading') return;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    fetch(`/api/activities?${queryString}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { items: Activity[] };
        setItems(data.items);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [queryString, geo.kind]);

  const grouped = useMemo(() => groupByDay(items ?? []), [items]);

  function toggleCategory(key: CategoryKey) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        // Fire-and-forget — server aggregates clicks for sort ordering.
        fetch('/api/categories/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        }).catch(() => {
          /* ignore */
        });
      }
      return next;
    });
  }

  return (
    <main>
      <header className="hero">
        <div className="hero-row">
          <div>
            <h1 className="wordmark">
              <Logo size={26} className="wordmark-logo" />proactivity
            </h1>
            <p className="tagline">Things to do near you, this week.</p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="header-cta"
              onClick={() => setShowSubmitForm(true)}
            >
              Submit your event
            </button>
            {me ? (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {noAds && <span className="badge badge-plus">Plus</span>}
                <button type="button" className="header-account" onClick={signOut} title={me.email}>
                  {me.name || me.email.split('@')[0]} · sign out
                </button>
              </span>
            ) : (
              <a href="/login" className="header-account">Sign in</a>
            )}
            {!noAds && (
              <a href="/pricing" className="header-account" style={{ color: 'var(--accent)' }}>
                Get Plus →
              </a>
            )}
          </div>
        </div>
        <LocationBar geo={geo} placeName={placeName} onRetry={() => window.location.reload()} />
      </header>

      <div className="controls">
        <input
          type="search"
          className="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events..."
          aria-label="Search events"
        />
        <div className="quick-filters">
          <select
            value={filters.sort}
            onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as typeof f.sort }))}
            aria-label="Sort order"
          >
            <option value="time">Soonest</option>
            <option value="distance" disabled={geo.kind !== 'ok'}>Distance</option>
            <option value="cost">Cheapest</option>
          </select>
          <select
            value={filters.dateRange}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                dateRange: e.target.value as typeof f.dateRange,
              }))
            }
            aria-label="Date range"
          >
            <option value="1">Today</option>
            <option value="2">Through tomorrow</option>
            <option value="7">Next 7 days</option>
            <option value="14">Next 2 weeks</option>
            <option value="30">Next month</option>
            <option value="all">All upcoming</option>
            <option value="past">Past events</option>
          </select>
          <select
            value={String(filters.radiusKm)}
            onChange={(e) => setFilters((f) => ({ ...f, radiusKm: Number(e.target.value) }))}
            disabled={geo.kind !== 'ok'}
            aria-label="Distance"
          >
            <option value="10">Within 10 km</option>
            <option value="25">Within 25 km</option>
            <option value="50">Within 50 km</option>
            <option value="100">Within 100 km</option>
          </select>
          <label className="toggle">
            <input
              type="checkbox"
              checked={filters.freeOnly}
              onChange={(e) => setFilters((f) => ({ ...f, freeOnly: e.target.checked }))}
            />
            <span>Free only</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={filters.includeUnavailable}
              onChange={(e) => setFilters((f) => ({ ...f, includeUnavailable: e.target.checked }))}
            />
            <span>Sold-out</span>
          </label>
        </div>

        <div className="categories" role="group" aria-label="Filter by category">
          {orderedCategories.map((key) => {
            const c = CATEGORIES[key];
            const active = activeCategories.has(key);
            return (
              <button
                key={key}
                type="button"
                className={`chip ${active ? 'chip-active' : ''}`}
                onClick={() => toggleCategory(key)}
                aria-pressed={active}
              >
                <span aria-hidden="true">{c.emoji}</span> {c.label}
              </button>
            );
          })}
          {activeCategories.size > 0 && (
            <button type="button" className="chip chip-clear" onClick={() => setActiveCategories(new Set())}>
              Clear
            </button>
          )}
        </div>
      </div>

      {loading && items === null && <SkeletonList />}
      {error && <div className="error">Failed to load: {error}</div>}
      {items && items.length === 0 && !loading && (
        <Empty
          searchActive={debouncedSearch.length > 0 || activeCategories.size > 0 || filters.freeOnly}
          onClear={() => {
            setSearch('');
            setActiveCategories(new Set());
            setFilters((f) => ({ ...f, freeOnly: false }));
          }}
        />
      )}

      {grouped.length > 0 && (
        <AdSlot slot={AD_SLOT_TOP} hidden={noAds} format="horizontal" />
      )}

      {(() => {
        let cardIndex = 0;
        return grouped.map(({ label, items: dayItems }) => (
          <section key={label} className="day-section">
            <h2 className="day-heading">{label}</h2>
            <div className="list">
              {dayItems.map((a) => {
                cardIndex++;
                const showAdAfter = cardIndex % AD_EVERY_N_CARDS === 0;
                return (
                  <Fragment key={a.id}>
                    <ActivityCard a={a} onRate={() => setRatingTarget(a)} />
                    {showAdAfter && (
                      <AdSlot slot={AD_SLOT_INFEED} hidden={noAds} format="fluid" />
                    )}
                  </Fragment>
                );
              })}
            </div>
          </section>
        ));
      })()}

      {ratingTarget && (
        <RatingModal
          activity={ratingTarget}
          me={me}
          onClose={() => setRatingTarget(null)}
        />
      )}

      {showSubmitForm && <SubmitEventModal me={me} onClose={() => setShowSubmitForm(false)} />}

      {items && items.length > 0 && (
        <footer className="footer">
          {items.length} {items.length === 1 ? 'event' : 'events'}
          {loading && ' · refreshing'}
        </footer>
      )}

      <p className="disclaimer">
        Events listed here are organized and run by third parties. Proactivity aggregates publicly available listings but is not responsible for event content, accuracy, conduct, or anything that happens at or as a result of attending. Verify details with the event organizer and use your own judgment.
      </p>
      <p className="disclaimer" style={{ marginTop: 8 }}>
        <a href="/about" style={{ color: 'var(--fg-muted)' }}>About</a>
        {' · '}
        <a href="/contact" style={{ color: 'var(--fg-muted)' }}>Contact</a>
        {' · '}
        <a href="/privacy" style={{ color: 'var(--fg-muted)' }}>Privacy policy</a>
      </p>
      <p className="disclaimer" style={{ marginTop: 4 }}>
        Powered by{' '}
        <a
          href="https://msw-technologies.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--fg-muted)' }}
        >
          MSW Technologies
        </a>
      </p>

      {showOnboarding && (
        <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
          <div className="onboarding-card">
            <h1 className="wordmark" style={{ marginBottom: 8 }}>
              <Logo size={26} className="wordmark-logo" />proactivity
            </h1>
            <h2 id="onboarding-title" className="onboarding-title">What interests you?</h2>
            <p className="onboarding-sub">
              Pick a few — we'll show you events you'll love first. You can change this later.
            </p>
            <div className="onboarding-chips">
              {orderedCategories.map((key) => {
                const c = CATEGORIES[key];
                const active = activeCategories.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`chip ${active ? 'chip-active' : ''}`}
                    onClick={() => toggleCategory(key)}
                    aria-pressed={active}
                  >
                    <span aria-hidden="true">{c.emoji}</span> {c.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={activeCategories.size === 0}
              onClick={() => completeOnboarding(false)}
            >
              {activeCategories.size > 0 ? `Continue (${activeCategories.size} selected)` : 'Pick at least one'}
            </button>
            <button
              type="button"
              className="onboarding-skip"
              onClick={() => completeOnboarding(true)}
            >
              Skip for now
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

// ----- helpers -----

function groupByDay(items: Activity[]): { label: string; items: Activity[] }[] {
  if (items.length === 0) return [];
  const map = new Map<string, Activity[]>();
  for (const a of items) {
    const label = dayLabel(new Date(a.startAt));
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(a);
  }
  return [...map.entries()].map(([label, items]) => ({ label, items }));
}

function dayLabel(date: Date): string {
  const now = new Date();
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((start.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays >= 2 && diffDays <= 6) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// ----- components -----

function LocationBar({
  geo,
  placeName,
  onRetry,
}: {
  geo: GeoState;
  placeName: string | null;
  onRetry: () => void;
}) {
  if (geo.kind === 'ok') {
    const label = placeName ?? `${geo.lat.toFixed(2)}, ${geo.lng.toFixed(2)}`;
    return <p className="loc">📍 near {label}</p>;
  }
  if (geo.kind === 'loading') return <p className="loc">Detecting your location…</p>;
  if (geo.kind === 'denied') {
    return (
      <p className="loc">
        Location declined — showing all events, sorted by time.{' '}
        <button type="button" className="loc-link" onClick={onRetry}>retry</button>
      </p>
    );
  }
  if (geo.kind === 'unsupported') {
    return <p className="loc">Your browser doesn't support geolocation.</p>;
  }
  return null;
}

function SubmitEventModal({
  me,
  onClose,
}: {
  me: { id: string; email: string; name: string | null } | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(me?.name ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [organization, setOrganization] = useState('');
  const [eventUrl, setEventUrl] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('A valid email is required.');
      return;
    }
    if (message.trim().length < 10) {
      setError('Tell us a bit about the event (10+ characters).');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim(),
          organization: organization.trim() || undefined,
          eventUrl: eventUrl.trim() || undefined,
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="onboarding-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="submit-title">
      <div className="onboarding-card" onClick={(e) => e.stopPropagation()}>
        {submitted ? (
          <>
            <h2 className="onboarding-title">Thanks!</h2>
            <p className="onboarding-sub">
              We got your message. We'll reach out at <strong>{email}</strong> after reviewing.
            </p>
            <button type="button" className="btn-primary" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <h2 id="submit-title" className="onboarding-title">Submit your event</h2>
            <p className="onboarding-sub">
              Run a venue, host meetups, or organize community events? Tell us about it and we'll add it to the calendar.
            </p>
            <input className="rating-input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={120} />
            <input className="rating-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (required)" maxLength={200} />
            <input className="rating-input" type="text" value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="Organization or venue" maxLength={200} />
            <input className="rating-input" type="url" value={eventUrl} onChange={(e) => setEventUrl(e.target.value)} placeholder="Event URL (optional)" maxLength={500} />
            <textarea
              className="rating-review"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={4000}
              placeholder="Tell us about your event — when, where, what to expect (required)"
              rows={5}
            />
            {error && <p className="rating-error">{error}</p>}
            <button type="button" className="btn-primary" disabled={submitting} onClick={submit}>
              {submitting ? 'Sending…' : 'Send'}
            </button>
            <button type="button" className="onboarding-skip" onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

function ActivityCard({ a, onRate }: { a: Activity; onRate: () => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const start = new Date(a.startAt);
  const timeStr = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const place = [a.venueName, a.city].filter(Boolean).join(' · ');
  const distance = a.distanceMeters != null ? `${(a.distanceMeters / 1000).toFixed(1)} km` : null;
  const price = formatPrice(a.costMinCents, a.costMaxCents, a.currency);
  const isAvailable = ['onsale', 'free', 'dropin'].includes(a.availability);
  const placeholder = placeholderFor({
    title: a.title,
    venueName: a.venueName,
    organizerName: a.organizer?.name,
    canonicalCategories: a.canonicalCategories,
  });
  const showImage = a.imageUrl && !imgFailed;

  const handleClick = () => {
    // Fire-and-forget — track popularity, don't block the click.
    fetch('/api/activities/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id }),
      keepalive: true,
    }).catch(() => {
      /* ignore */
    });
  };

  return (
    <a className="card" href={a.url ?? '#'} target="_blank" rel="noreferrer" onClick={handleClick}>
      {showImage ? (
        <img
          className="card-img"
          src={a.imageUrl!}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          className="card-img card-img-placeholder"
          style={{ backgroundColor: placeholder.color, color: 'white' }}
        >
          {placeholder.emoji}
        </div>
      )}
      <div className="card-body">
        <p className="card-title">{a.title}</p>
        <p className="card-meta">
          <time dateTime={a.startAt}>{timeStr}</time>
          {place ? <> · {place}</> : null}
          {distance ? <> · {distance}</> : null}
        </p>
        {a.canonicalCategories.length > 0 && (
          <p className="card-tags">
            {a.canonicalCategories.slice(0, 4).map((k) => (
              <span key={k} className="card-tag">
                {CATEGORIES[k].emoji} {CATEGORIES[k].label}
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="card-right">
        <span className={`badge ${isAvailable ? '' : 'badge-soldout'}`}>{availabilityLabel(a.availability)}</span>
        {a.ageRange && <span className="badge badge-age">{a.ageRange.label}</span>}
        {a.ratingCount > 0 && a.ratingAverage != null && (
          <span className="rating-summary" title={`${a.ratingCount} rating${a.ratingCount === 1 ? '' : 's'}`}>
            ★ {a.ratingAverage.toFixed(1)} <span className="rating-count">({a.ratingCount})</span>
          </span>
        )}
        {a.organizer && a.organizer.ratingCount > 0 && a.organizer.ratingAverage != null && (
          <span className="rating-summary rating-organizer" title={`organizer · ${a.organizer.ratingCount} rating${a.organizer.ratingCount === 1 ? '' : 's'}`}>
            org ★ {a.organizer.ratingAverage.toFixed(1)} <span className="rating-count">({a.organizer.ratingCount})</span>
          </span>
        )}
        {price && <span className="price">{price}</span>}
        <button
          type="button"
          className="rate-link"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRate();
          }}
        >
          Rate ▸
        </button>
      </div>
    </a>
  );
}

function RatingModal({
  activity,
  me,
  onClose,
}: {
  activity: Activity;
  me: { id: string; email: string; name: string | null } | null;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<'event' | 'organizer'>('event');
  const [score, setScore] = useState(0);
  const [review, setReview] = useState('');
  const [name, setName] = useState(me?.name ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (score < 1) {
      setError('Pick a star rating first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId: activity.id,
          target,
          score,
          review: review.trim() || undefined,
          submitterName: name.trim() || undefined,
          submitterEmail: email.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="onboarding-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="rating-title">
      <div className="onboarding-card" onClick={(e) => e.stopPropagation()}>
        {submitted ? (
          <>
            <h2 className="onboarding-title">Thanks!</h2>
            <p className="onboarding-sub">
              Your review of <strong>{activity.title}</strong> is pending approval. It'll show up once an admin OKs it.
            </p>
            <button type="button" className="btn-primary" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <h2 id="rating-title" className="onboarding-title">
              {target === 'event' ? 'Rate this event' : `Rate ${activity.organizer?.name ?? 'this organizer'}`}
            </h2>
            <p className="onboarding-sub" style={{ marginBottom: 14 }}>
              {target === 'event'
                ? activity.title
                : `Your rating applies to all events from ${activity.organizer?.name ?? 'this organizer'}.`}
            </p>
            {activity.organizer?.name && (
              <div className="rating-target-toggle" role="tablist" aria-label="Rate event or organizer">
                <button
                  type="button"
                  role="tab"
                  aria-selected={target === 'event'}
                  className={`rating-target-tab ${target === 'event' ? 'rating-target-tab-on' : ''}`}
                  onClick={() => setTarget('event')}
                >
                  This event
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={target === 'organizer'}
                  className={`rating-target-tab ${target === 'organizer' ? 'rating-target-tab-on' : ''}`}
                  onClick={() => setTarget('organizer')}
                >
                  Organizer
                </button>
              </div>
            )}
            <div className="rating-stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`rating-star ${score >= n ? 'rating-star-on' : ''}`}
                  onClick={() => setScore(n)}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              className="rating-review"
              value={review}
              onChange={(e) => setReview(e.target.value)}
              maxLength={2000}
              placeholder="Optional — what was it like?"
              rows={4}
            />
            <input
              type="text"
              className="rating-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              maxLength={80}
            />
            <input
              type="email"
              className="rating-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional, not shown publicly)"
              maxLength={200}
            />
            {error && <p className="rating-error">{error}</p>}
            <button
              type="button"
              className="btn-primary"
              disabled={submitting || score < 1}
              onClick={submit}
            >
              {submitting ? 'Submitting…' : 'Submit review'}
            </button>
            <button type="button" className="onboarding-skip" onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

function availabilityLabel(a: string): string {
  switch (a) {
    case 'onsale': return 'On sale';
    case 'free': return 'Free';
    case 'dropin': return 'Drop-in';
    case 'sold_out': return 'Sold out';
    case 'cancelled': return 'Cancelled';
    default: return 'TBD';
  }
}

function formatPrice(min: number | null, max: number | null, currency: string | null): string | null {
  if (min == null && max == null) return null;
  if (min === 0 && (max == null || max === 0)) return 'Free';
  const cur = currency ?? 'USD';
  const fmt = (cents: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(cents / 100);
  if (min != null && max != null && min !== max) return `${fmt(min)}–${fmt(max)}`;
  return fmt((min ?? max) as number);
}

function SkeletonList() {
  return (
    <div className="list">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card card-skeleton">
          <div className="card-img card-img-placeholder" />
          <div className="card-body">
            <div className="skel-line skel-line-title" />
            <div className="skel-line skel-line-meta" />
            <div className="skel-line skel-line-meta" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ searchActive, onClear }: { searchActive: boolean; onClear: () => void }) {
  return (
    <div className="empty">
      <p className="empty-emoji" aria-hidden="true">🔍</p>
      <h2>Nothing matches that</h2>
      <p>
        {searchActive
          ? 'Try clearing some filters or expanding the date range.'
          : 'No events in this window — try widening the date range.'}
      </p>
      {searchActive && (
        <button type="button" className="btn-primary" onClick={onClear}>
          Clear filters
        </button>
      )}
    </div>
  );
}
