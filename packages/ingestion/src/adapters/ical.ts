import ical from 'node-ical';
import type {
  NormalizedActivity,
  SourceAdapter,
  FetchContext,
  ParseConfigResult,
} from '../types.js';

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
      yield* expand(ev, now, horizon, config, defaultAvailability, defaultDurationMs);
    }
  },
};

function* expand(
  ev: ical.VEvent,
  now: Date,
  horizon: Date,
  cfg: IcalConfig,
  defaultAvailability: NormalizedActivity['availability'],
  defaultDurationMs: number,
): Iterable<NormalizedActivity> {
  // VEVENT.start is a Date with extra fields (.tz). VEVENT.end may be undefined.
  const baseStart = ev.start as Date | undefined;
  const baseEnd = ev.end as Date | undefined;
  if (!baseStart) return;

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

  for (const start of occurrences) {
    if (exdates.has(normalizeExdateKey(start.toISOString()))) continue;
    const end = new Date(start.getTime() + baseDurationMs);
    yield mapInstance(ev, start, end, cfg, defaultAvailability);
  }
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
): NormalizedActivity {
  const isRecurring = ev.rrule != null;
  // Recurring instances need unique source IDs per occurrence so re-ingestion
  // is idempotent at the instance level.
  const sourceEventId = isRecurring ? `${ev.uid}::${start.toISOString()}` : ev.uid;

  // node-ical types are incomplete: CATEGORIES is parsed at runtime but absent from VEvent.
  const evExtra = ev as ical.VEvent & { categories?: unknown };
  const categories = parseCategories(evExtra.categories);

  return {
    sourceEventId,
    title: ev.summary || '(untitled)',
    description: stripIcalEscapes(ev.description) ?? null,
    startAt: start,
    endAt: end,
    timezone: (start as Date & { tz?: string }).tz ?? null,
    venueName: null,
    address: stripIcalEscapes(ev.location) ?? null,
    city: null,
    region: null,
    country: null,
    location: { lng: cfg.lng, lat: cfg.lat },
    ageMin: null,
    ageMax: null,
    costMinCents: null,
    costMaxCents: null,
    currency: null,
    availability: defaultAvailability,
    url: ev.url ?? null,
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
