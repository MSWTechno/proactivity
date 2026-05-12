import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Reverse-geocode a lat/lng into a human-readable place name via Nominatim
// (OpenStreetMap). Free, no API key, but rate-limited to ~1 req/sec and
// requires a polite User-Agent. We round coordinates to 2 decimals (~1km)
// for a small in-memory cache to drastically reduce API hits.
//
// Response: { name: string }   (empty string if lookup failed or no result)

const cache = new Map<string, { name: string; ts: number }>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
const CACHE_MAX = 500;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'lat/lng out of range' }, { status: 400 });
  }

  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(
      { name: cached.name },
      { headers: { 'cache-control': 'public, max-age=86400' } },
    );
  }

  try {
    const nominatim = new URL('https://nominatim.openstreetmap.org/reverse');
    nominatim.searchParams.set('lat', String(lat));
    nominatim.searchParams.set('lon', String(lng));
    nominatim.searchParams.set('format', 'json');
    nominatim.searchParams.set('zoom', '10');
    nominatim.searchParams.set('addressdetails', '1');

    const res = await fetch(nominatim.toString(), {
      headers: {
        'User-Agent': 'Proactivity/0.1 (+https://github.com/MSWTechno/proactivity)',
        Accept: 'application/json',
      },
      // Don't let a slow nominatim hang the request.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json({ name: '' });
    }
    const data = (await res.json()) as NominatimResponse;
    const name = formatPlaceName(data);

    // Trim cache if it grows too large (simple LRU-ish: drop oldest).
    if (cache.size >= CACHE_MAX) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
    cache.set(key, { name, ts: Date.now() });

    return NextResponse.json(
      { name },
      { headers: { 'cache-control': 'public, max-age=86400' } },
    );
  } catch {
    return NextResponse.json({ name: '' });
  }
}

interface NominatimResponse {
  display_name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    suburb?: string;
    state?: string;
    'ISO3166-2-lvl4'?: string;
    country_code?: string;
  };
}

function formatPlaceName(data: NominatimResponse): string {
  const addr = data.address ?? {};
  const locality =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.hamlet ||
    addr.municipality ||
    addr.suburb ||
    '';
  // 'ISO3166-2-lvl4' is like "US-VA" — extract "VA". Else fall back to full state name.
  const stateCode = addr['ISO3166-2-lvl4']?.split('-')[1];
  const region = stateCode || addr.state || '';
  return [locality, region].filter(Boolean).join(', ');
}
