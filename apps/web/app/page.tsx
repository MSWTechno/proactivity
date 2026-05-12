'use client';

import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, type CategoryKey, ALL_CATEGORY_KEYS } from '@/lib/categories';
import { placeholderFor } from '@/lib/icons';

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
  costMinCents: number | null;
  costMaxCents: number | null;
  currency: string | null;
  availability: string;
  url: string | null;
  imageUrl: string | null;
  canonicalCategories: CategoryKey[];
  distanceMeters: number | null;
}

type GeoState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; lat: number; lng: number }
  | { kind: 'denied' }
  | { kind: 'unsupported' };

export default function HomePage() {
  const [geo, setGeo] = useState<GeoState>({ kind: 'idle' });
  const [filters, setFilters] = useState({
    radiusKm: 25,
    daysAhead: 7,
    sort: 'time' as 'distance' | 'time' | 'cost',
    freeOnly: false,
    includeUnavailable: false,
  });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<CategoryKey>>(new Set());
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
    p.set('daysAhead', String(filters.daysAhead));
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
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <main>
      <header className="hero">
        <h1 className="wordmark">
          <span className="dot" aria-hidden="true" />proactivity
        </h1>
        <p className="tagline">Things to do near you, this week.</p>
        <LocationBar geo={geo} onRetry={() => window.location.reload()} />
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
            value={String(filters.daysAhead)}
            onChange={(e) => setFilters((f) => ({ ...f, daysAhead: Number(e.target.value) }))}
            aria-label="Date range"
          >
            <option value="1">Today</option>
            <option value="2">Through tomorrow</option>
            <option value="7">Next 7 days</option>
            <option value="14">Next 2 weeks</option>
            <option value="30">Next month</option>
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
          {ALL_CATEGORY_KEYS.map((key) => {
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

      {grouped.map(({ label, items: dayItems }) => (
        <section key={label} className="day-section">
          <h2 className="day-heading">{label}</h2>
          <div className="list">
            {dayItems.map((a) => (
              <ActivityCard key={a.id} a={a} />
            ))}
          </div>
        </section>
      ))}

      {items && items.length > 0 && (
        <footer className="footer">
          {items.length} {items.length === 1 ? 'event' : 'events'}
          {loading && ' · refreshing'}
        </footer>
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

function LocationBar({ geo, onRetry }: { geo: GeoState; onRetry: () => void }) {
  if (geo.kind === 'ok') {
    return (
      <p className="loc">📍 near {geo.lat.toFixed(2)}, {geo.lng.toFixed(2)}</p>
    );
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

function ActivityCard({ a }: { a: Activity }) {
  const start = new Date(a.startAt);
  const timeStr = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const place = [a.venueName, a.city].filter(Boolean).join(' · ');
  const distance = a.distanceMeters != null ? `${(a.distanceMeters / 1000).toFixed(1)} km` : null;
  const price = formatPrice(a.costMinCents, a.costMaxCents, a.currency);
  const isAvailable = ['onsale', 'free', 'dropin'].includes(a.availability);
  const placeholder = placeholderFor({ title: a.title, canonicalCategories: a.canonicalCategories });

  return (
    <a className="card" href={a.url ?? '#'} target="_blank" rel="noreferrer">
      {a.imageUrl ? (
        <img className="card-img" src={a.imageUrl} alt="" loading="lazy" />
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
        {price && <span className="price">{price}</span>}
      </div>
    </a>
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
