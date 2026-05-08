'use client';

import { useEffect, useMemo, useState } from 'react';

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
  categories: string[] | null;
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
    sort: 'distance' as 'distance' | 'time' | 'cost',
    freeOnly: false,
    maxCost: '' as string,
    includeUnavailable: false,
  });
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Request geolocation once on mount.
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
    else if (filters.maxCost) p.set('maxCostCents', String(Math.round(Number(filters.maxCost) * 100)));
    if (filters.includeUnavailable) p.set('includeUnavailable', '1');
    return p.toString();
  }, [geo, filters]);

  // Fetch activities whenever filters or location change.
  useEffect(() => {
    // Wait until geo resolves (either way) before first fetch.
    if (geo.kind === 'idle' || geo.kind === 'loading') return;
    setLoading(true);
    setError(null);
    fetch(`/api/activities?${queryString}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { items: Activity[] };
        setItems(data.items);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [queryString, geo.kind]);

  return (
    <main>
      <h1>Proactivity</h1>
      <p className="lede">Things to do near you in the next week.</p>

      <LocationBar geo={geo} onRetry={() => window.location.reload()} />

      <div className="filters">
        <label>
          Sort by
          <select
            value={filters.sort}
            onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as typeof f.sort }))}
          >
            <option value="distance">Distance</option>
            <option value="time">Soonest</option>
            <option value="cost">Cheapest</option>
          </select>
        </label>
        <label>
          Within (km)
          <input
            type="number"
            min={1}
            max={500}
            value={filters.radiusKm}
            onChange={(e) => setFilters((f) => ({ ...f, radiusKm: Number(e.target.value) || 25 }))}
          />
        </label>
        <label>
          Next (days)
          <input
            type="number"
            min={1}
            max={30}
            value={filters.daysAhead}
            onChange={(e) => setFilters((f) => ({ ...f, daysAhead: Number(e.target.value) || 7 }))}
          />
        </label>
        <label>
          Max cost ($)
          <input
            type="number"
            min={0}
            disabled={filters.freeOnly}
            value={filters.maxCost}
            onChange={(e) => setFilters((f) => ({ ...f, maxCost: e.target.value }))}
            placeholder="any"
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.freeOnly}
            onChange={(e) => setFilters((f) => ({ ...f, freeOnly: e.target.checked }))}
          />
          Free only
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.includeUnavailable}
            onChange={(e) => setFilters((f) => ({ ...f, includeUnavailable: e.target.checked }))}
          />
          Include sold-out
        </label>
      </div>

      {loading && <div className="loading">Loading activities…</div>}
      {error && <div className="error">Failed to load: {error}</div>}
      {!loading && !error && items && items.length === 0 && (
        <div className="empty">
          No activities found in the next {filters.daysAhead} day{filters.daysAhead === 1 ? '' : 's'}. Try widening the radius or date range.
        </div>
      )}
      {items && items.length > 0 && (
        <div className="list">
          {items.map((a) => (
            <ActivityCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </main>
  );
}

function LocationBar({ geo, onRetry }: { geo: GeoState; onRetry: () => void }) {
  if (geo.kind === 'ok') {
    return (
      <div className="location-bar">
        Showing activities near {geo.lat.toFixed(2)}, {geo.lng.toFixed(2)}
      </div>
    );
  }
  if (geo.kind === 'loading') return <div className="location-bar">Detecting your location…</div>;
  if (geo.kind === 'denied') {
    return (
      <div className="location-bar">
        Location access denied — showing without distance sort.{' '}
        <button onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (geo.kind === 'unsupported') {
    return <div className="location-bar">Your browser doesn't support geolocation.</div>;
  }
  return null;
}

function ActivityCard({ a }: { a: Activity }) {
  const start = new Date(a.startAt);
  const dateStr = start.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const place = [a.venueName, a.city].filter(Boolean).join(' · ');
  const distance = a.distanceMeters != null ? `${(a.distanceMeters / 1000).toFixed(1)} km` : null;
  const price = formatPrice(a.costMinCents, a.costMaxCents, a.currency);
  const isAvailable = ['onsale', 'free', 'dropin'].includes(a.availability);

  return (
    <a className="card" href={a.url ?? '#'} target="_blank" rel="noreferrer">
      {a.imageUrl ? <img className="img" src={a.imageUrl} alt="" /> : <div className="img" />}
      <div>
        <p className="title">{a.title}</p>
        <p className="meta">
          {dateStr}
          {place ? ` · ${place}` : ''}
          {distance ? ` · ${distance}` : ''}
        </p>
        {a.categories && a.categories.length > 0 && (
          <p className="meta">{a.categories.slice(0, 3).join(' · ')}</p>
        )}
      </div>
      <div className="right">
        <span className={`badge ${isAvailable ? '' : 'soldout'}`}>{availabilityLabel(a.availability)}</span>
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
    default: return 'Unknown';
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
