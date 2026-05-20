/**
 * Address → lat/lng geocoding with a permanent DB-backed cache.
 *
 * Uses Nominatim (OpenStreetMap) by default: free, no API key, but a
 * strict 1 req/sec policy + required identifying User-Agent. Per the
 * usage policy (https://operations.osmfoundation.org/policies/nominatim/),
 * we:
 *   - throttle to one outbound request per second across all callers
 *     in this Node process (in-memory global timestamp)
 *   - identify ourselves via UA
 *   - cache aggressively in venue_geocodes so the same address never
 *     hits the upstream twice
 *
 * The cache stores failures too (not_found / error) so repeated cron
 * runs don't keep retrying addresses Nominatim can't resolve.
 */

import { db, venueGeocodes, sql as pgSql } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Proactivity/1.0 (https://proactivity.app; warrenms@gmail.com)';
const MIN_INTERVAL_MS = 1100; // 1.1s to stay safely under the 1 req/sec ceiling
const REQUEST_TIMEOUT_MS = 8000;

// Serial queue across all callers in this process. The naive "read
// lastRequestAt, sleep, then update it" pattern races under our 4-worker
// runner — 4 callers see the same lastRequestAt, all sleep the same
// duration, all fire in the same second, Nominatim 429s the burst.
// This chain guarantees one outbound at a time + a MIN_INTERVAL gap
// after each one before the next starts.
let geocodeChain: Promise<unknown> = Promise.resolve();
async function withNominatimSlot<T>(fn: () => Promise<T>): Promise<T> {
  const previous = geocodeChain;
  let release!: () => void;
  const myTurn = new Promise<void>((r) => { release = r; });
  geocodeChain = previous.then(() => myTurn);
  await previous;
  try {
    return await fn();
  } finally {
    setTimeout(release, MIN_INTERVAL_MS);
  }
}

export interface GeocodeResult {
  lat: number;
  lng: number;
}

/**
 * Resolve an address to coords. Returns null on cache-miss + upstream
 * failure (caller should fall back to source-hub coords).
 */
export async function geocodeAddress(rawAddr: string | null | undefined): Promise<GeocodeResult | null> {
  const normalized = normalizeAddress(rawAddr ?? '');
  if (!normalized) return null;

  // Cache hit?
  const cached = await db
    .select({ lat: venueGeocodes.lat, lng: venueGeocodes.lng, status: venueGeocodes.status })
    .from(venueGeocodes)
    .where(eq(venueGeocodes.normalizedAddress, normalized))
    .limit(1);
  if (cached[0]) {
    if (cached[0].status === 'ok' && cached[0].lat != null && cached[0].lng != null) {
      return { lat: cached[0].lat, lng: cached[0].lng };
    }
    return null; // cached failure — don't retry until admin clears it
  }

  return withNominatimSlot(async () => {
    try {
      const url = new URL(NOMINATIM_URL);
      url.searchParams.set('q', normalized);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '1');
      url.searchParams.set('addressdetails', '0');
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        await cacheResult(normalized, null, null, 'error');
        return null;
      }
      const json = (await res.json()) as Array<{ lat?: string; lon?: string }>;
      const hit = json[0];
      if (!hit || !hit.lat || !hit.lon) {
        await cacheResult(normalized, null, null, 'not_found');
        return null;
      }
      const lat = parseFloat(hit.lat);
      const lng = parseFloat(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        await cacheResult(normalized, null, null, 'not_found');
        return null;
      }
      await cacheResult(normalized, lat, lng, 'ok');
      return { lat, lng };
    } catch (e) {
      console.warn(`[geocode] failed for "${normalized}":`, e instanceof Error ? e.message : e);
      await cacheResult(normalized, null, null, 'error');
      return null;
    }
  });
}

function normalizeAddress(addr: string): string {
  // Lowercase + collapse whitespace + strip surrounding punctuation.
  // Keeps "1491 virginia ave, harrisonburg, va 22802, usa" as a stable key.
  return addr
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/^\s*[,;]+\s*|\s*[,;]+\s*$/g, '')
    .trim()
    .toLowerCase()
    .slice(0, 300);
}

async function cacheResult(
  addr: string,
  lat: number | null,
  lng: number | null,
  status: 'ok' | 'not_found' | 'error',
): Promise<void> {
  await pgSql`
    INSERT INTO venue_geocodes (normalized_address, lat, lng, source, status)
    VALUES (${addr}, ${lat}, ${lng}, 'nominatim', ${status})
    ON CONFLICT (normalized_address) DO UPDATE SET
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      status = EXCLUDED.status,
      updated_at = NOW()
  `;
}
