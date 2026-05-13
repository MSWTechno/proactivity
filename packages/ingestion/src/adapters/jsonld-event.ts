import type {
  NormalizedActivity,
  SourceAdapter,
  FetchContext,
  ParseConfigResult,
} from '../types.js';

/**
 * Generic scraper for sites that publish schema.org/Event JSON-LD on their
 * event detail pages. Two-step:
 *   1. Fetch entryUrl (HTML listing page OR WP REST API endpoint),
 *      extract event-detail URLs (HTML anchors or JSON `link` fields).
 *   2. For each detail URL, fetch and parse the embedded JSON-LD `Event`.
 *
 * Confirmed working on:
 *   - eventbrite.com (entryUrl: /d/<location>/events/, paginated via ?page=)
 *   - visitshenandoah.org event detail pages (entryUrl: WP REST endpoint)
 *
 * Eventbrite ToS prohibits broad scraping; the discovery URL is not in
 * robots.txt's disallow list (it's publicly indexed) but treat this as
 * supplementary, throttle aggressively, and stop on cease-and-desist.
 */

const ALLOWED_AVAILABILITY: NormalizedActivity['availability'][] = [
  'onsale',
  'free',
  'dropin',
  'unknown',
];

interface JsonLdConfig {
  entryUrl: string;
  lat: number;
  lng: number;
  defaultAvailability?: NormalizedActivity['availability'];
  maxPages?: number;
  maxEvents?: number;
  throttleMs?: number;
}

function isJsonLdConfig(v: unknown): v is JsonLdConfig {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.entryUrl === 'string' && typeof c.lat === 'number' && typeof c.lng === 'number';
}

export const jsonLdEventAdapter: SourceAdapter = {
  key: 'jsonld-event',
  configHelp: '<entryUrl> <lat> <lng> [defaultAvailability=onsale] [maxPages=5]',
  parseCliConfig(args: string[]): ParseConfigResult {
    if (args.length < 3 || args.length > 5) {
      return { ok: false, error: 'expected <entryUrl> <lat> <lng> [defaultAvailability] [maxPages]' };
    }
    const [entryUrlRaw, latStr, lngStr, availStr, maxPagesStr] = args as [
      string, string, string, string?, string?,
    ];
    let entryUrl: string;
    try {
      entryUrl = new URL(entryUrlRaw).toString();
    } catch {
      return { ok: false, error: `invalid url: "${entryUrlRaw}"` };
    }
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: 'lat must be in [-90, 90]' };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: 'lng must be in [-180, 180]' };

    const availability = (availStr ?? 'onsale') as NormalizedActivity['availability'];
    if (!ALLOWED_AVAILABILITY.includes(availability)) {
      return { ok: false, error: `defaultAvailability must be one of ${ALLOWED_AVAILABILITY.join('|')}` };
    }
    const maxPages = maxPagesStr != null ? Number(maxPagesStr) : 5;
    if (!Number.isFinite(maxPages) || maxPages < 1 || maxPages > 20) {
      return { ok: false, error: 'maxPages must be in [1, 20]' };
    }
    return {
      ok: true,
      config: { entryUrl, lat, lng, defaultAvailability: availability, maxPages },
    };
  },

  async *fetch({ config, signal }: FetchContext): AsyncIterable<NormalizedActivity> {
    if (!isJsonLdConfig(config)) {
      throw new Error('jsonld-event adapter: config must be { entryUrl, lat, lng, ... }');
    }
    const maxPages = config.maxPages ?? 5;
    const maxEvents = config.maxEvents ?? 100;
    const throttleMs = config.throttleMs ?? 300;
    const defaultAvailability = config.defaultAvailability ?? 'onsale';

    const host = new URL(config.entryUrl).host;
    const linkPattern = pickLinkPattern(host);
    const now = new Date();
    // Ingest everything upcoming. UI filters to a window.
    const horizon = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const seenUrls = new Set<string>();
    const detailUrlsToFetch = new Set<string>();
    let yielded = 0;

    // Pass 1: Walk pagination on the entry URL. For each page, try direct
    // Event JSON-LD extraction (Meetup-style) first. If that yields events,
    // we won't need to crawl detail pages for that listing.
    for (let page = 1; page <= maxPages; page++) {
      if (signal?.aborted) return;
      const pageUrl = page === 1 ? config.entryUrl : appendPageParam(config.entryUrl, page);
      const text = await fetchText(pageUrl, signal);

      const directEvents = extractEventJsonLd(text);
      let yieldedThisPage = 0;
      for (const ev of directEvents) {
        const url = ev.url;
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        const start = parseLooseIso(ev.startDate);
        if (!start || start < now || start > horizon) continue;
        yield mapToActivity(ev, url, config, defaultAvailability);
        yielded++;
        yieldedThisPage++;
        if (yielded >= maxEvents) return;
      }

      if (yieldedThisPage === 0) {
        // No direct events — collect detail URLs from this page for pass 2.
        const sizeBefore = detailUrlsToFetch.size;
        for (const u of extractDetailUrls(text, linkPattern)) {
          if (!seenUrls.has(u)) detailUrlsToFetch.add(u);
        }
        if (detailUrlsToFetch.size === sizeBefore && page > 1) break; // pagination yielded nothing new
      }
    }

    // Pass 2: For sites where the listing only contains links (Eventbrite),
    // fetch each detail page and extract its Event JSON-LD.
    let firstFetch = true;
    for (const detailUrl of Array.from(detailUrlsToFetch).slice(0, maxEvents - yielded)) {
      if (signal?.aborted) return;
      if (!firstFetch) await sleep(throttleMs, signal);
      firstFetch = false;
      try {
        const html = await fetchText(detailUrl, signal);
        const events = extractEventJsonLd(html);
        for (const ev of events) {
          if (seenUrls.has(detailUrl)) continue;
          seenUrls.add(detailUrl);
          const start = parseLooseIso(ev.startDate);
          if (!start || start < now || start > horizon) continue;
          yield mapToActivity(ev, detailUrl, config, defaultAvailability);
          yielded++;
          if (yielded >= maxEvents) return;
        }
      } catch (e) {
        console.warn(`  [jsonld-event] skipping ${detailUrl}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (yielded === 0) {
      console.warn(`  [jsonld-event] no events extracted from ${config.entryUrl}`);
    }
  },
};

// ---- URL extraction ----

function pickLinkPattern(host: string): RegExp {
  if (host.endsWith('eventbrite.com')) {
    return /href=["'](https:\/\/www\.eventbrite\.com\/e\/[^"'?#]+)/g;
  }
  if (host.endsWith('meetup.com')) {
    return /href=["'](https:\/\/www\.meetup\.com\/[^"'\/]+\/events\/[0-9]+[^"'?#]*)["']/g;
  }
  // Visit Shenandoah and other WP-events sites
  if (/visitshenandoah\.org$|visitshenandoah\.com$/.test(host)) {
    return /https:\/\/[^"'\s]*\/events\/[a-z0-9-]+\//g;
  }
  // Generic fallback: any anchor href containing "/event"
  return /href=["']([^"']*\/(?:event|events)\/[a-z0-9][^"'?#]*)["']/gi;
}

function extractDetailUrls(text: string, pattern: RegExp): string[] {
  // If the entry response is a JSON array (WP REST API), pull `link` fields.
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed) as Array<{ link?: string }>;
      return data.map((d) => d.link).filter((l): l is string => typeof l === 'string');
    } catch {
      // fall through to regex
    }
  }
  // HTML — match anchor hrefs.
  const out: string[] = [];
  for (const m of text.matchAll(pattern)) {
    const url = m[1] ?? m[0];
    if (url) out.push(url);
  }
  return [...new Set(out)];
}

function appendPageParam(url: string, page: number): string {
  const u = new URL(url);
  u.searchParams.set('page', String(page));
  return u.toString();
}

// ---- JSON-LD Event extraction ----

const JSON_LD_BLOCK = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;

interface EventLd {
  '@type'?: string | string[];
  name?: string;
  description?: string;
  url?: string;
  image?: string | string[];
  startDate?: string;
  endDate?: string;
  eventStatus?: string;
  eventAttendanceMode?: string;
  organizer?:
    | { '@type'?: string; name?: string; url?: string }
    | Array<{ '@type'?: string; name?: string; url?: string }>;
  location?: {
    '@type'?: string;
    name?: string;
    address?:
      | string
      | {
          streetAddress?: string;
          addressLocality?: string;
          addressRegion?: string;
          addressCountry?: string;
        };
    geo?: { latitude?: number | string; longitude?: number | string };
  };
  offers?:
    | {
        lowPrice?: string | number;
        highPrice?: string | number;
        price?: string | number;
        priceCurrency?: string;
        availability?: string;
      }
    | Array<{
        lowPrice?: string | number;
        highPrice?: string | number;
        price?: string | number;
        priceCurrency?: string;
        availability?: string;
      }>;
}

function extractEventJsonLd(html: string): EventLd[] {
  const out: EventLd[] = [];
  for (const m of html.matchAll(JSON_LD_BLOCK)) {
    const raw = m[1];
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const items = collectItems(parsed);
    for (const item of items) {
      const t = item['@type'];
      if (t === 'Event' || (Array.isArray(t) && t.includes('Event')) || (typeof t === 'string' && t.endsWith('Event'))) {
        out.push(item);
      }
    }
  }
  return out;
}

function collectItems(parsed: unknown): EventLd[] {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.flatMap(collectItems);
  if (typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) return collectItems(obj['@graph']);
    return [obj as EventLd];
  }
  return [];
}

// ---- Mapping ----

function mapToActivity(
  ev: EventLd,
  detailUrl: string,
  cfg: JsonLdConfig,
  defaultAvailability: NormalizedActivity['availability'],
): NormalizedActivity {
  const sourceEventId = stableEventId(detailUrl);
  const startAt = parseLooseIso(ev.startDate)!;
  const endAt = parseLooseIso(ev.endDate);
  const timezone = parseTzOffset(ev.startDate!) ?? null;
  const offers = Array.isArray(ev.offers) ? ev.offers[0] : ev.offers;
  const price = offers
    ? parsePrice(offers.lowPrice ?? offers.price)
    : null;
  const priceMax = offers ? parsePrice(offers.highPrice ?? offers.price) : null;
  const availability = mapAvailability(ev, defaultAvailability);
  const isVirtual = detectVirtual(ev);

  const addr = typeof ev.location?.address === 'object' ? ev.location.address : null;
  const addressString = typeof ev.location?.address === 'string'
    ? ev.location.address
    : [addr?.streetAddress, addr?.addressLocality, addr?.addressRegion]
        .filter((s): s is string => !!s)
        .join(', ') || null;

  const evGeo = ev.location?.geo;
  const evLat = evGeo?.latitude != null ? Number(evGeo.latitude) : null;
  const evLng = evGeo?.longitude != null ? Number(evGeo.longitude) : null;
  const useEventCoords = Number.isFinite(evLat ?? NaN) && Number.isFinite(evLng ?? NaN);

  return {
    sourceEventId,
    title: ev.name ?? '(untitled)',
    description: ev.description ? stripHtml(ev.description) : null,
    startAt,
    endAt,
    timezone,
    venueName: ev.location?.name ?? null,
    address: addressString,
    city: addr?.addressLocality ?? null,
    region: addr?.addressRegion ?? null,
    country: addr?.addressCountry ?? null,
    location: useEventCoords ? { lng: evLng!, lat: evLat! } : { lng: cfg.lng, lat: cfg.lat },
    ageMin: null,
    ageMax: null,
    costMinCents: price,
    costMaxCents: priceMax,
    currency: offers?.priceCurrency ?? null,
    availability,
    isVirtual,
    organizerName: pickOrganizer(ev.organizer)?.name ?? null,
    organizerUrl: pickOrganizer(ev.organizer)?.url ?? null,
    organizerKey: null, // runner derives from name/url
    url: ev.url ?? detailUrl,
    imageUrl: pickImage(ev.image, detailUrl),
    categories: null,
    raw: ev as unknown,
  };
}

function stableEventId(url: string): string {
  // Use the path+query as a stable id; avoids needing host-specific parsing.
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

function parseTzOffset(iso: string): string | null {
  // Capture trailing offset like "-04:00" or "+05:30" or "Z".
  const m = iso.match(/(Z|[+-]\d{1,2}:?\d{0,2})$/);
  return m?.[1] ?? null;
}

/**
 * Lenient ISO 8601 parser. Handles non-standard formats some sites publish:
 *   - single-digit month/day:    "2026-5-9T..."
 *   - missing seconds:            "T16:00-5:00"
 *   - single-digit offset hour:   "-5:00"
 * Returns null for unparseable input.
 */
function parseLooseIso(s: string | undefined | null): Date | null {
  if (!s) return null;
  // Strict parse first.
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const m = s.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{1,2}:?\d{0,2})?$/,
  );
  if (!m) return null;
  const [, year, month, day, hour, minute, second = '00', tzRaw = 'Z'] = m;
  let tz: string;
  if (tzRaw === 'Z') {
    tz = 'Z';
  } else {
    const tzMatch = tzRaw.match(/^([+-])(\d{1,2}):?(\d{0,2})$/);
    tz = tzMatch
      ? `${tzMatch[1]}${tzMatch[2]!.padStart(2, '0')}:${(tzMatch[3] || '00').padStart(2, '0')}`
      : 'Z';
  }
  const normalized = `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}T${hour!.padStart(2, '0')}:${minute}:${second}${tz}`;
  d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function parsePrice(v: string | number | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function detectVirtual(ev: EventLd): boolean {
  // schema.org/Event eventAttendanceMode IRIs:
  //   - OfflineEventAttendanceMode  → in-person (in-scope)
  //   - OnlineEventAttendanceMode   → virtual
  //   - MixedEventAttendanceMode    → hybrid — treat as virtual since the
  //     in-person part may be elsewhere
  const mode = ev.eventAttendanceMode;
  if (typeof mode === 'string') {
    if (/OnlineEventAttendanceMode|MixedEventAttendanceMode/i.test(mode)) return true;
  }
  // Some sources publish `location: { '@type': 'VirtualLocation', url: '...' }`.
  const loc = ev.location;
  const locType = typeof loc === 'object' && loc ? (loc as { '@type'?: string })['@type'] : undefined;
  if (typeof locType === 'string' && /VirtualLocation/i.test(locType)) return true;
  return false;
}

function mapAvailability(
  ev: EventLd,
  fallback: NormalizedActivity['availability'],
): NormalizedActivity['availability'] {
  const status = ev.eventStatus ?? '';
  if (/Cancelled/i.test(status)) return 'cancelled';
  if (/Postponed|Rescheduled/i.test(status)) return 'unknown';
  const offers = Array.isArray(ev.offers) ? ev.offers[0] : ev.offers;
  if (offers?.availability) {
    if (/SoldOut/i.test(offers.availability)) return 'sold_out';
    if (/InStock/i.test(offers.availability)) return 'onsale';
  }
  const price = offers ? Number(offers.lowPrice ?? offers.price ?? -1) : -1;
  if (price === 0) return 'free';
  return fallback;
}

function pickOrganizer(
  organizer: EventLd['organizer'],
): { name?: string; url?: string } | null {
  if (!organizer) return null;
  const o = Array.isArray(organizer) ? organizer[0] : organizer;
  if (!o) return null;
  return { name: o.name, url: o.url };
}

function pickImage(image: string | string[] | undefined, baseUrl: string): string | null {
  const raw = !image ? null : typeof image === 'string' ? image : image[0] ?? null;
  if (!raw) return null;
  // Resolve relative URLs to absolute (some sites publish "/path/img.jpg").
  let absolute: string;
  try {
    absolute = new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
  // Drop generic fallback/placeholder images — our title-icon is better.
  if (/\/(fallbacks?|placeholders?|defaults?|generic)\//i.test(absolute)) return null;
  if (/group-cover-\d+-square|default-group-cover/i.test(absolute)) return null;
  return absolute;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- HTTP ----

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Proactivity/0.1 (+https://github.com/proactivity)',
      Accept: 'text/html, application/json, */*;q=0.5',
    },
    signal,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    }, { once: true });
  });
}
