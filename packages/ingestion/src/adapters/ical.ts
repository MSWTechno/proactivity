import ical from 'node-ical';
import type {
  NormalizedActivity,
  SourceAdapter,
  FetchContext,
  ParseConfigResult,
} from '../types.js';
import { geocodeAddress } from '../geocode.js';

interface IcalConfig {
  url: string;
  lat: number;
  lng: number;
  /** Default availability for events from this feed. iCal doesn't carry this signal. */
  defaultAvailability?: NormalizedActivity['availability'];
  /** Fall-through for events with no DTEND. */
  defaultDurationMinutes?: number;
}

const ALLOWED_AVAILABILITY: NormalizedActivity['availability'][] = [
  'onsale',
  'free',
  'dropin',
  'unknown',
];

function isIcalConfig(v: unknown): v is IcalConfig {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.url === 'string' &&
    typeof c.lat === 'number' &&
    typeof c.lng === 'number'
  );
}

export const icalAdapter: SourceAdapter = {
  key: 'ical',
  configHelp: '<url> <lat> <lng> [defaultAvailability=free]',
  parseCliConfig(args: string[]): ParseConfigResult {
    if (args.length < 3 || args.length > 4) {
      return { ok: false, error: 'expected <url> <lat> <lng> [defaultAvailability]' };
    }
    const [url, latStr, lngStr, availStr] = args as [string, string, string, string?];
    try {
      new URL(url);
    } catch {
      return { ok: false, error: `invalid url: "${url}"` };
    }
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: 'lat must be in [-90, 90]' };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: 'lng must be in [-180, 180]' };
    const availability = (availStr ?? 'free') as NormalizedActivity['availability'];
    if (!ALLOWED_AVAILABILITY.includes(availability)) {
      return {
        ok: false,
        error: `defaultAvailability must be one of ${ALLOWED_AVAILABILITY.join('|')}`,
      };
    }
    return { ok: true, config: { url, lat, lng, defaultAvailability: availability } };
  },

  async *fetch({ config, signal }: FetchContext): AsyncIterable<NormalizedActivity> {
    if (!isIcalConfig(config)) {
      throw new Error('ical adapter: config must be { url, lat, lng, defaultAvailability? }');
    }

    // Some hosts reject default Node UAs; fetch directly so we control headers.
    const res = await fetch(config.url, {
      headers: {
        'User-Agent': 'Proactivity/0.1 (+https://github.com/proactivity)',
        Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5',
      },
      signal,
    });
    if (!res.ok) throw new Error(`ical fetch ${res.status}: ${res.statusText}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) {
      throw new Error(
        `response from ${config.url} is not iCalendar (got ${res.headers.get('content-type') ?? 'unknown'})`,
      );
    }
    const data = ical.parseICS(text);
    if (signal?.aborted) return;

    const now = new Date();
    // Ingest everything upcoming (up to ~1 year out). UI filters to a window.
    const horizon = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const defaultAvailability = config.defaultAvailability ?? 'free';
    const defaultDurationMs = (config.defaultDurationMinutes ?? 60) * 60 * 1000;

    for (const key in data) {
      const ev = data[key];
      if (!ev || ev.type !== 'VEVENT') continue;
      yield* await expand(ev, now, horizon, config, defaultAvailability, defaultDurationMs);
    }
  },
};

async function expand(
  ev: ical.VEvent,
  now: Date,
  horizon: Date,
  cfg: IcalConfig,
  defaultAvailability: NormalizedActivity['availability'],
  defaultDurationMs: number,
): Promise<NormalizedActivity[]> {
  // VEVENT.start is a Date with extra fields (.tz). VEVENT.end may be undefined.
  const baseStart = ev.start as Date | undefined;
  const baseEnd = ev.end as Date | undefined;
  if (!baseStart) return [];

  const baseDurationMs =
    baseEnd && baseEnd.getTime() > baseStart.getTime()
      ? baseEnd.getTime() - baseStart.getTime()
      : defaultDurationMs;

  // Set of EXDATE keys (ISO date strings).
  const exdates = ev.exdate
    ? new Set(Object.keys(ev.exdate).map((k) => normalizeExdateKey(k)))
    : new Set<string>();

  const occurrences = ev.rrule
    ? ev.rrule.between(now, horizon, true)
    : baseStart >= now && baseStart <= horizon
      ? [baseStart]
      : [];

  if (occurrences.length === 0) return [];

  // Geocode the LOCATION once per VEVENT and share across all occurrences —
  // recurring events have one venue, no need to hit Nominatim N times.
  // Per-event GEO still wins if present (set inside mapInstance).
  const evGeo = (ev as ical.VEvent & { geo?: { lat?: number; lon?: number } }).geo;
  const hasEvGeo = typeof evGeo?.lat === 'number' && typeof evGeo?.lon === 'number';
  let geocoded: { lat: number; lng: number } | null = null;
  const addr = stripIcalEscapes(ev.location);
  if (!hasEvGeo && addr) {
    const r = await geocodeAddress(addr);
    if (r) geocoded = { lat: r.lat, lng: r.lng };
  }

  const out: NormalizedActivity[] = [];
  for (const start of occurrences) {
    if (exdates.has(normalizeExdateKey(start.toISOString()))) continue;
    const end = new Date(start.getTime() + baseDurationMs);
    out.push(mapInstance(ev, start, end, cfg, defaultAvailability, geocoded));
  }
  return out;
}

function normalizeExdateKey(s: string): string {
  // node-ical uses ISO with milliseconds for some keys; trim to seconds for matching.
  return s.replace(/\.\d{3}/, '').replace(/Z$/, '');
}

function mapInstance(
  ev: ical.VEvent,
  start: Date,
  end: Date,
  cfg: IcalConfig,
  defaultAvailability: NormalizedActivity['availability'],
  geocodedAddress: { lat: number; lng: number } | null,
): NormalizedActivity {
  const isRecurring = ev.rrule != null;
  // Recurring instances need unique source IDs per occurrence so re-ingestion
  // is idempotent at the instance level.
  const sourceEventId = isRecurring ? `${ev.uid}::${start.toISOString()}` : ev.uid;

  // node-ical types are incomplete: CATEGORIES and ORGANIZER are parsed at
  // runtime but absent from VEvent.
  const evExtra = ev as ical.VEvent & {
    categories?: unknown;
    organizer?: string | { val?: string; params?: { CN?: string } };
  };
  const categories = parseCategories(evExtra.categories);
  const { organizerName, organizerUrl } = parseOrganizer(evExtra.organizer);

  const address = stripIcalEscapes(ev.location) ?? null;
  const rawDescription = stripIcalEscapes(ev.description) ?? null;
  // CivicEngage (Spotsylvania County, others) sets URL: to the feed's
  // own relative path and puts the actual event-detail URL as the first
  // token of DESCRIPTION. Extract it and strip from the description so
  // we don't render the bare URL twice on the detail page.
  const descUrlMatch = rawDescription?.match(/^\s*(https?:\/\/\S+)\s*\n?/);
  const descUrl = descUrlMatch?.[1] ?? null;
  const description = descUrlMatch
    ? rawDescription!.slice(descUrlMatch[0].length).trim() || null
    : rawDescription;

  // URL resolution: prefer URL: when it's absolute, else any absolute
  // URL we extracted from the description, else null (the /go endpoint
  // bounces to /event/[id] for events with no real outbound link).
  const evUrlRaw = ev.url && typeof ev.url === 'string' ? ev.url.trim() : null;
  const url = evUrlRaw && /^https?:\/\//i.test(evUrlRaw)
    ? evUrlRaw
    : descUrl;

  // Prefer per-event GEO when the iCal feed carries it (RFC 5545 GEO
  // property is parsed by node-ical as { lat, lon }). Without this every
  // event from a source ends up sharing the source-hub coords, which
  // collapses distance display to 0.0 mi when the user is centered on
  // that hub.
  // Priority: per-event GEO > geocoded LOCATION text > source-default hub.
  const evGeo = (ev as ical.VEvent & { geo?: { lat?: number; lon?: number } }).geo;
  const evLat = typeof evGeo?.lat === 'number' && Number.isFinite(evGeo.lat) ? evGeo.lat : null;
  const evLng = typeof evGeo?.lon === 'number' && Number.isFinite(evGeo.lon) ? evGeo.lon : null;
  const location = evLat != null && evLng != null
    ? { lat: evLat, lng: evLng }
    : geocodedAddress
      ? geocodedAddress
      : { lng: cfg.lng, lat: cfg.lat };

  return {
    sourceEventId,
    title: ev.summary || '(untitled)',
    description,
    startAt: start,
    endAt: end,
    timezone: (start as Date & { tz?: string }).tz ?? null,
    venueName: null,
    address,
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
    isVirtual: detectVirtual(address, description, categories),
    organizerName,
    organizerUrl,
    organizerKey: null, // runner derives
    url,
    imageUrl: null,
    categories,
    raw: {
      uid: ev.uid,
      summary: ev.summary,
      description: ev.description,
      location: ev.location,
      url: ev.url,
      start: ev.start,
      end: ev.end,
      categories: evExtra.categories,
    },
  };
}

function parseOrganizer(
  value: unknown,
): { organizerName: string | null; organizerUrl: string | null } {
  if (!value) return { organizerName: null, organizerUrl: null };
  if (typeof value === 'string') {
    // Plain string — often a mailto: or just an email
    return { organizerName: null, organizerUrl: value };
  }
  if (typeof value === 'object') {
    const v = value as { val?: string; params?: { CN?: string } };
    return {
      organizerName: v.params?.CN ?? null,
      organizerUrl: v.val ?? null,
    };
  }
  return { organizerName: null, organizerUrl: null };
}

function parseCategories(value: unknown): string[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value.length > 0 ? value.map(String) : null;
  if (typeof value === 'string') {
    const parts = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : null;
  }
  return null;
}

function stripIcalEscapes(s: string | undefined): string | null {
  if (!s) return null;
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
}

/**
 * Best-effort virtual-event detection for iCal feeds, which don't carry a
 * schema.org-style eventAttendanceMode. Signals (any one is enough):
 *   - CATEGORIES contains "Virtual" / "Online" / "Webinar" (Bridgewater
 *     College and others use this convention)
 *   - LOCATION is itself a URL (a meeting link with no street address)
 *   - LOCATION contains an obvious meeting-platform marker (Zoom, Teams,
 *     Webex, Google Meet, GoToMeeting)
 *   - DESCRIPTION contains an obvious join-link phrase ("join zoom",
 *     "via zoom", "zoom meeting", "webinar registration", etc.)
 *
 * Conservative on purpose: bare "online" in a description is too broad
 * (registration pages, online tickets, etc.) so it's not matched alone.
 */
function detectVirtual(
  address: string | null,
  description: string | null,
  categories: string[] | null,
): boolean {
  if (categories?.some((c) => /^(virtual|online|webinar)$/i.test(c.trim()))) {
    return true;
  }
  const loc = address?.trim() ?? '';
  if (/^https?:\/\//i.test(loc)) return true;
  const locLower = loc.toLowerCase();
  if (/\b(zoom|microsoft teams|google meet|webex|gotomeeting|virtual event|webinar)\b/.test(locLower)) {
    return true;
  }
  const desc = (description ?? '').toLowerCase();
  if (/\b(zoom meeting|via zoom|join zoom|webinar registration|webcast|livestream|virtual event)\b/.test(desc)) {
    return true;
  }
  return false;
}
