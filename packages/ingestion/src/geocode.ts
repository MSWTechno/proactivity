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
export async function geocodeAddress(
  rawAddr: string | null | undefined,
  near?: { lat: number; lng: number; bboxDegrees?: number },
): Promise<GeocodeResult | null> {
  const normalized = normalizeAddress(rawAddr ?? '');
  if (!normalized) return null;

  // Cache key includes the geographic anchor when one's given so a
  // bounded retry doesn't collide with a prior unbounded miss (and
  // vice versa). Plain key when no anchor.
  const cacheKey = near
    ? `${normalized}|near:${near.lat.toFixed(2)},${near.lng.toFixed(2)}`.slice(0, 300)
    : normalized;

  const cached = await db
    .select({ lat: venueGeocodes.lat, lng: venueGeocodes.lng, status: venueGeocodes.status })
    .from(venueGeocodes)
    .where(eq(venueGeocodes.normalizedAddress, cacheKey))
    .limit(1);
  if (cached[0]) {
    if (cached[0].status === 'ok' && cached[0].lat != null && cached[0].lng != null) {
      return { lat: cached[0].lat, lng: cached[0].lng };
    }
    return null; // cached failure — don't retry until admin clears it
  }

  // Clean the address before sending. Cache key stays original; query
  // upstream is scrubbed.
  const upstreamQuery = buildGeocodeQuery(normalized);
  if (!upstreamQuery) {
    await cacheResult(cacheKey, null, null, 'not_found');
    return null;
  }
  // Try to peel out street/city/state/postalcode. Nominatim's structured
  // search is dramatically more reliable than freeform for US addresses
  // whose mailing city doesn't match the OSM municipality (e.g. Patriot
  // Park's "Fredericksburg, VA 22408" mailing addr is really in
  // Spotsylvania County — freeform returns empty, structured finds it).
  const structured = parseUsAddress(upstreamQuery);

  return withNominatimSlot(async () => {
    try {
      const url = new URL(NOMINATIM_URL);
      if (structured) {
        // Structured form: street + state + (postalcode if known) +
        // country. Skip city because it's the part most likely to be a
        // mailing-only mismatch.
        url.searchParams.set('street', structured.street);
        url.searchParams.set('state', structured.state);
        if (structured.postalcode) url.searchParams.set('postalcode', structured.postalcode);
        url.searchParams.set('country', 'US');
      } else {
        url.searchParams.set('q', upstreamQuery);
      }
      // Anchor-bounded freeform/structured search. Stops "9 Amherst St"
      // (no city/state in the source) from landing in Buffalo NY when
      // we know the event is in VA. bounded=1 returns empty if nothing
      // is in the box — the adapter then falls through to title-pattern
      // or source hub.
      if (near) {
        const b = near.bboxDegrees ?? 0.6;
        const left = near.lng - b;
        const right = near.lng + b;
        const top = near.lat + b;
        const bottom = near.lat - b;
        url.searchParams.set('viewbox', `${left},${top},${right},${bottom}`);
        url.searchParams.set('bounded', '1');
      }
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '1');
      url.searchParams.set('addressdetails', '0');
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        await cacheResult(cacheKey, null, null, 'error');
        return null;
      }
      const json = (await res.json()) as Array<{ lat?: string; lon?: string }>;
      const hit = json[0];
      if (!hit || !hit.lat || !hit.lon) {
        await cacheResult(cacheKey, null, null, 'not_found');
        return null;
      }
      const lat = parseFloat(hit.lat);
      const lng = parseFloat(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        await cacheResult(cacheKey, null, null, 'not_found');
        return null;
      }
      await cacheResult(cacheKey, lat, lng, 'ok');
      return { lat, lng };
    } catch (e) {
      console.warn(`[geocode] failed for "${normalized}":`, e instanceof Error ? e.message : e);
      await cacheResult(cacheKey, null, null, 'error');
      return null;
    }
  });
}

/**
 * Heuristic fallback for events that have no address/geo in their
 * source — looks up a venue name biased to a geographic anchor (the
 * source's hub coords). Uses Nominatim's `viewbox` + `bounded=1` so
 * "Coal Ridge Brewery" doesn't match a same-named place in another
 * state. Caches under a distinct `place:<name>@<lat,lng>` key so the
 * address-based cache stays clean.
 */
export async function geocodeNamedPlace(
  name: string,
  near: { lat: number; lng: number },
  bboxDegrees = 0.6,
): Promise<GeocodeResult | null> {
  const cleaned = name.trim();
  if (!cleaned || cleaned.length < 3) return null;
  // Cache key encodes the rough bbox so a tighter/wider re-search
  // doesn't collide. Round to keep the key stable across runs.
  const anchor = `${near.lat.toFixed(2)},${near.lng.toFixed(2)}`;
  const cacheKey = `place:${cleaned.toLowerCase()}@${anchor}`.slice(0, 300);

  const cached = await db
    .select({ lat: venueGeocodes.lat, lng: venueGeocodes.lng, status: venueGeocodes.status })
    .from(venueGeocodes)
    .where(eq(venueGeocodes.normalizedAddress, cacheKey))
    .limit(1);
  if (cached[0]) {
    if (cached[0].status === 'ok' && cached[0].lat != null && cached[0].lng != null) {
      return { lat: cached[0].lat, lng: cached[0].lng };
    }
    return null;
  }

  return withNominatimSlot(async () => {
    try {
      const url = new URL(NOMINATIM_URL);
      url.searchParams.set('q', cleaned);
      // viewbox format: left,top,right,bottom (lng,lat,lng,lat).
      const left = near.lng - bboxDegrees;
      const right = near.lng + bboxDegrees;
      const top = near.lat + bboxDegrees;
      const bottom = near.lat - bboxDegrees;
      url.searchParams.set('viewbox', `${left},${top},${right},${bottom}`);
      url.searchParams.set('bounded', '1');
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '1');
      url.searchParams.set('countrycodes', 'us');
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        await cacheResult(cacheKey, null, null, 'error');
        return null;
      }
      const json = (await res.json()) as Array<{ lat?: string; lon?: string }>;
      const hit = json[0];
      if (!hit || !hit.lat || !hit.lon) {
        await cacheResult(cacheKey, null, null, 'not_found');
        return null;
      }
      const lat = parseFloat(hit.lat);
      const lng = parseFloat(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        await cacheResult(cacheKey, null, null, 'not_found');
        return null;
      }
      await cacheResult(cacheKey, lat, lng, 'ok');
      return { lat, lng };
    } catch (e) {
      console.warn(`[geocode-place] failed for "${cleaned}":`, e instanceof Error ? e.message : e);
      await cacheResult(cacheKey, null, null, 'error');
      return null;
    }
  });
}

function normalizeAddress(addr: string): string {
  // Lowercase + collapse whitespace + strip surrounding punctuation.
  // Keeps "1491 virginia ave, harrisonburg, va 22802, usa" as a stable key.
  // CivicEngage (Spotsylvania) prefixes locations with " - " which
  // Nominatim then chokes on — eat any leading non-alphanumeric run so
  // we send "5710 smith station road..." not "- 5710 smith station...".
  return addr
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9]+$/, '')
    .trim()
    .toLowerCase()
    .slice(0, 300);
}

/**
 * Build a cleaner query string for Nominatim from a raw address.
 * The cache key stays the original normalized address (so re-runs hit
 * the cache), but what we send upstream is scrubbed of common noise
 * Nominatim chokes on:
 *   - leading venue name like "venue name, 123 main st..." (Nominatim
 *     prefers just the postal portion)
 *   - duplicated city/state pieces ("harrisonburg, va, va, 22801")
 *   - suite / apt / unit / floor / building specifiers
 *   - trailing "united states" / "usa" (Nominatim handles VA-only fine)
 *   - parenthetical asides
 *
 * Empty result means we don't bother sending to Nominatim — straight
 * to not_found.
 */
function buildGeocodeQuery(normalized: string): string {
  let q = normalized;

  // Drop parenthetical asides.
  q = q.replace(/\([^)]*\)/g, ' ');

  // Drop suite/apt/unit/floor specifiers (with or without "#"), e.g.
  // "ste 105", "suite 200", "#7", "apt 3b", "unit 12", "7th floor".
  q = q.replace(/[,\s]+(ste|suite|apt|apartment|unit|building|bldg|fl|floor|rm|room|#)\s*[\w-]+/gi, ' ');
  q = q.replace(/[,\s]+\d+(?:st|nd|rd|th)\s+floor/gi, ' ');

  // Drop trailing country tokens. Nominatim resolves US addresses fine without.
  q = q.replace(/[,\s]+(united states(?: of america)?|u\.?s\.?a\.?|usa)[,\s]*$/i, ' ');

  // Collapse duplicated city/state: e.g. "harrisonburg, va, va, 22801" or
  // "richmond, va, richmond, va". Walk the comma-separated parts and
  // drop a part that exactly equals the immediately previous one OR
  // a state-only ('va') that follows another state-only.
  const parts = q
    .split(',')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const deduped: string[] = [];
  for (const p of parts) {
    const last = deduped[deduped.length - 1];
    if (last && p === last) continue;
    // Drop "virginia" if previous was "va" (and vice versa).
    if (last && ((last === 'va' && p === 'virginia') || (last === 'virginia' && p === 'va'))) continue;
    deduped.push(p);
  }

  // If the first part doesn't start with a digit and there's at least
  // 3 parts left, assume it's a venue name — drop it. (e.g.
  // "white oak lavender farm, 2644 cross keys rd, harrisonburg, va"
  // → "2644 cross keys rd, harrisonburg, va")
  if (deduped.length >= 3 && !/^\d/.test(deduped[0]!)) {
    deduped.shift();
  }

  q = deduped.join(', ').replace(/\s+/g, ' ').trim();
  return q;
}

/**
 * Best-effort parse of a US street address into structured Nominatim
 * fields. Returns null when the address doesn't have a recognisable
 * "<number> <street> ... <STATE> [ZIP]" shape — the caller falls back
 * to freeform `q=` in that case.
 *
 * Works for both comma-separated ("5710 Smith Station Road,
 * Fredericksburg, VA 22408") and the space-only CivicEngage shape
 * ("5710 smith station road fredericksburg va 22408").
 */
function parseUsAddress(s: string): { street: string; state: string; postalcode?: string } | null {
  // Trailing 2-letter state, optionally followed by a 5-digit ZIP.
  const m = s.match(/\b([a-z]{2})\b[,\s]+(\d{5})(?:-\d{4})?\s*$/i)
    ?? s.match(/\b([a-z]{2})\b\s*$/i);
  if (!m) return null;
  const state = m[1]!.toUpperCase();
  const postalcode = m[2];

  // Everything before the state token. Trim trailing commas/spaces.
  const beforeState = s.slice(0, m.index).replace(/[,\s]+$/, '').trim();

  // Cut off at the last street-suffix token. This drops trailing city
  // names that Nominatim treats as junk in the street field — Patriot
  // Park resolves with "5710 smith station road" but fails with
  // "5710 smith station road fredericksburg".
  const suffix = /\b(road|rd|street|st|avenue|ave|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|highway|hwy|parkway|pkwy|circle|cir|pike|terrace|ter|trail|trl|loop|alley|aly)\b/gi;
  let lastEnd = -1;
  let mm: RegExpExecArray | null;
  while ((mm = suffix.exec(beforeState)) !== null) lastEnd = mm.index + mm[0].length;

  // Two paths to a usable structured query:
  //   (a) street starts with a house number ("5710 smith station road")
  //   (b) no house number but a street suffix is present — keep just
  //       the street name ("Skyline Dr Mile 41.7 Shenandoah National
  //       Park" → "Skyline Dr"). Nominatim resolves these as roads.
  // If neither holds we bail and let the caller use freeform.
  const startsWithNumber = /^\s*\d/.test(beforeState);
  if (!startsWithNumber && lastEnd <= 0) return null;

  const street = lastEnd > 0
    ? beforeState.slice(0, lastEnd).replace(/[,\s]+$/, '').trim()
    : beforeState;
  if (!street) return null;
  return { street, state, ...(postalcode ? { postalcode } : {}) };
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
