import type {
  NormalizedActivity,
  SourceAdapter,
  FetchContext,
  ParseConfigResult,
} from '../types.js';
import { geocodeAddress } from '../geocode.js';

/**
 * Adapter for WordPress sites running the EventOn plugin.
 *
 * EventOn registers `ajde_events` as a public Custom Post Type, so the
 * standard WP REST API exposes events at `/wp-json/wp/v2/ajde_events?_embed=1`
 * with all event-specific fields (start_date, end_date, event_occurrences,
 * event_location_0, eventon_featured_image, learn_more) at the top level.
 *
 * Confirmed working on visitharrisonburgva.com (2026-05).
 */

interface EventonConfig {
  /** Site root, e.g. "https://visitharrisonburgva.com" — no trailing slash. */
  baseUrl: string;
  lat: number;
  lng: number;
  defaultAvailability?: NormalizedActivity['availability'];
  /**
   * IANA timezone for parsing the site's local-time event dates.
   * EventOn stores dates as "MM/DD/YYYY hh:mm:ss am/pm" without explicit TZ.
   */
  defaultTimezone?: string;
}

const ALLOWED_AVAILABILITY: NormalizedActivity['availability'][] = [
  'onsale',
  'free',
  'dropin',
  'unknown',
];

const PER_PAGE = 100;
const MAX_PAGES = 10; // 1000 events max per run — plenty for one site.

function isEventonConfig(v: unknown): v is EventonConfig {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.baseUrl === 'string' && typeof c.lat === 'number' && typeof c.lng === 'number';
}

export const eventonAdapter: SourceAdapter = {
  key: 'eventon',
  configHelp: '<baseUrl> <lat> <lng> [defaultAvailability=free] [tz=America/New_York]',
  parseCliConfig(args: string[]): ParseConfigResult {
    if (args.length < 3 || args.length > 5) {
      return { ok: false, error: 'expected <baseUrl> <lat> <lng> [defaultAvailability] [tz]' };
    }
    const [baseUrlRaw, latStr, lngStr, availStr, tzStr] = args as [
      string, string, string, string?, string?,
    ];
    let baseUrl: string;
    try {
      baseUrl = new URL(baseUrlRaw).origin;
    } catch {
      return { ok: false, error: `invalid url: "${baseUrlRaw}"` };
    }
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: 'lat must be in [-90, 90]' };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: 'lng must be in [-180, 180]' };
    const availability = (availStr ?? 'free') as NormalizedActivity['availability'];
    if (!ALLOWED_AVAILABILITY.includes(availability)) {
      return { ok: false, error: `defaultAvailability must be one of ${ALLOWED_AVAILABILITY.join('|')}` };
    }
    const defaultTimezone = tzStr ?? 'America/New_York';
    return {
      ok: true,
      config: { baseUrl, lat, lng, defaultAvailability: availability, defaultTimezone },
    };
  },

  async *fetch({ config, signal }: FetchContext): AsyncIterable<NormalizedActivity> {
    if (!isEventonConfig(config)) {
      throw new Error('eventon adapter: config must be { baseUrl, lat, lng, ... }');
    }
    const tz = config.defaultTimezone ?? 'America/New_York';
    const defaultAvailability = config.defaultAvailability ?? 'free';
    const now = new Date();
    // Ingest everything upcoming (up to ~1 year out). UI filters to a window.
    const horizon = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (signal?.aborted) return;
      const url = `${config.baseUrl}/wp-json/wp/v2/ajde_events?per_page=${PER_PAGE}&page=${page}&_embed=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Proactivity/0.1 (+https://github.com/proactivity)' },
        signal,
      });
      if (res.status === 400 || res.status === 404) {
        // WP returns 400 "rest_post_invalid_page_number" past the last page.
        return;
      }
      if (!res.ok) throw new Error(`eventon ${res.status}: ${await res.text()}`);

      const events = (await res.json()) as EventonEvent[];
      if (events.length === 0) return;

      for (const e of events) {
        yield* await expandEvent(e, config, tz, defaultAvailability, now, horizon);
      }

      const totalPages = Number(res.headers.get('x-wp-totalpages') ?? '1');
      if (page >= totalPages) return;
    }
  },
};

async function expandEvent(
  e: EventonEvent,
  cfg: EventonConfig,
  tz: string,
  defaultAvailability: NormalizedActivity['availability'],
  now: Date,
  horizon: Date,
): Promise<NormalizedActivity[]> {
  const out: NormalizedActivity[] = [];
  const occurrences =
    e.event_occurrences && e.event_occurrences.length > 0
      ? e.event_occurrences
      : [{ start: e.start_date, end: e.end_date }];

  const venue = e.event_location_0;
  const rawAddress = venue?.location_address ? decodeEntities(venue.location_address) : null;
  // Geocode once per venue (helper has its own cache). Falls back to the
  // source's hub coords if Nominatim doesn't resolve the address.
  const geo = rawAddress ? await geocodeAddress(rawAddress) : null;
  const location = geo ? { lat: geo.lat, lng: geo.lng } : { lng: cfg.lng, lat: cfg.lat };

  for (const occ of occurrences) {
    const startAt = parseUsDateInTz(occ.start, tz);
    if (!startAt || startAt < now || startAt > horizon) continue;
    const endAt = occ.end ? parseUsDateInTz(occ.end, tz) : null;

    const isRecurring = occurrences.length > 1;
    const sourceEventId = isRecurring ? `${e.id}::${occ.start}` : String(e.id);

    const categories = extractCategories(e);
    const description = stripHtml(e.excerpt?.rendered ?? e.content?.rendered ?? '') || null;

    out.push({
      sourceEventId,
      title: decodeEntities(e.title?.rendered ?? '(untitled)'),
      description,
      startAt,
      endAt,
      timezone: e.event_timezone || tz,
      venueName: venue?.name ? decodeEntities(venue.name) : null,
      address: rawAddress,
      city: null,
      region: null,
      country: null,
      location,
      ageMin: null,
      ageMax: null,
      costMinCents: null,
      costMaxCents: null,
      currency: null,
      availability: defaultAvailability,
      url: e.link ?? null,
      imageUrl: e.eventon_featured_image || null,
      categories: categories.length > 0 ? categories : null,
      raw: {
        id: e.id,
        slug: e.slug,
        link: e.link,
        start_date: e.start_date,
        end_date: e.end_date,
        event_timezone: e.event_timezone,
        event_location_0: e.event_location_0,
        learn_more: e.learn_more,
      },
    });
  }
  return out;
}

/**
 * Parse "MM/DD/YYYY HH:MM:SS am/pm" treating the time as local in `tz`.
 * Returns the corresponding UTC Date.
 */
function parseUsDateInTz(s: string | undefined, tz: string): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;
  const [, mo, da, ye, ho, mi, se, ampm] = m;
  let hour = Number(ho);
  if (ampm) {
    const lower = ampm.toLowerCase();
    if (lower === 'pm' && hour !== 12) hour += 12;
    if (lower === 'am' && hour === 12) hour = 0;
  }
  // Construct a candidate UTC instant using the local components.
  const utcGuess = Date.UTC(Number(ye), Number(mo) - 1, Number(da), hour, Number(mi), Number(se));
  // Compute the offset of `tz` at that instant.
  const offsetMin = getTzOffsetMinutes(new Date(utcGuess), tz);
  // Real UTC = (local components interpreted as UTC) - tz offset.
  return new Date(utcGuess - offsetMin * 60_000);
}

function getTzOffsetMinutes(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asLocalUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asLocalUtc - date.getTime()) / 60_000;
}

function extractCategories(e: EventonEvent): string[] {
  const out: string[] = [];
  const terms = e._embedded?.['wp:term'];
  if (Array.isArray(terms)) {
    for (const group of terms) {
      if (!Array.isArray(group)) continue;
      for (const t of group) {
        if (t?.taxonomy === 'event_type' || t?.taxonomy === 'event_type_2' || t?.taxonomy === 'eventon_category') {
          if (t.name) out.push(decodeEntities(t.name));
        }
      }
    }
  }
  return out;
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// ---- Subset of EventOn's WP REST API event shape ----

interface EventonEvent {
  id: number;
  slug?: string;
  link?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  start_date?: string;
  end_date?: string;
  event_timezone?: string;
  event_all_day?: string | boolean;
  eventon_featured_image?: string;
  learn_more?: { url?: string; target?: string } | null;
  event_occurrences?: Array<{ start: string; end?: string }>;
  event_location_0?: {
    name?: string;
    slug?: string;
    location_address?: string;
  } | null;
  _embedded?: {
    'wp:term'?: Array<Array<{ taxonomy?: string; name?: string }>>;
  };
}
