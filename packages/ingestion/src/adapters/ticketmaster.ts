import type { NormalizedActivity, SourceAdapter, FetchContext, ParseConfigResult } from '../types.js';

const BASE_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';
const PAGE_SIZE = 100;
// Ticketmaster caps deep pagination at page 49 (5000 results) for the v2 API.
const MAX_PAGES = 49;

interface TmConfig {
  lat: number;
  lng: number;
  radiusKm: number;
  /** Default 90 — ingest everything upcoming; UI filters per-request. */
  daysAhead?: number;
}

function isTmConfig(v: unknown): v is TmConfig {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.lat === 'number' && typeof c.lng === 'number' && typeof c.radiusKm === 'number';
}

export const ticketmasterAdapter: SourceAdapter = {
  key: 'ticketmaster',
  configHelp: '<lat> <lng> [radiusKm]',
  parseCliConfig(args: string[]): ParseConfigResult {
    if (args.length < 2 || args.length > 3) {
      return { ok: false, error: 'expected <lat> <lng> [radiusKm]' };
    }
    const lat = Number(args[0]);
    const lng = Number(args[1]);
    const radiusKm = args[2] != null ? Number(args[2]) : 50;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: `lat must be in [-90, 90]` };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: `lng must be in [-180, 180]` };
    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 500) return { ok: false, error: 'radiusKm must be in (0, 500]' };
    return { ok: true, config: { lat, lng, radiusKm } };
  },
  async *fetch({ config, signal }: FetchContext): AsyncIterable<NormalizedActivity> {
    if (!isTmConfig(config)) {
      throw new Error('ticketmaster adapter: config must be { lat, lng, radiusKm, daysAhead? }');
    }
    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) throw new Error('TICKETMASTER_API_KEY not set');

    const days = config.daysAhead ?? 90;
    const now = new Date();
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    for (let page = 0; page < MAX_PAGES; page++) {
      if (signal?.aborted) return;

      const params = new URLSearchParams({
        apikey: apiKey,
        latlong: `${config.lat},${config.lng}`,
        radius: String(Math.round(config.radiusKm)),
        unit: 'km',
        startDateTime: toTmDate(now),
        endDateTime: toTmDate(end),
        size: String(PAGE_SIZE),
        page: String(page),
        sort: 'date,asc',
      });

      const res = await fetch(`${BASE_URL}?${params.toString()}`, { signal });
      if (res.status === 429) {
        // Rate limit — wait and retry once.
        await sleep(2000);
        page--;
        continue;
      }
      if (!res.ok) throw new Error(`ticketmaster ${res.status}: ${await res.text()}`);

      const data = (await res.json()) as TmResponse;
      const events = data._embedded?.events ?? [];
      for (const e of events) {
        const item = mapEvent(e);
        if (item) yield item;
      }
      const totalPages = data.page?.totalPages ?? 0;
      if (page + 1 >= totalPages) return;
    }
  },
};

function toTmDate(d: Date): string {
  // Ticketmaster expects ISO 8601 in UTC with no milliseconds, ending in Z.
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mapEvent(e: TmEvent): NormalizedActivity | null {
  const startIso = e.dates?.start?.dateTime;
  if (!startIso) return null; // skip events without a definite start time

  const venue = e._embedded?.venues?.[0];
  const lng = venue?.location?.longitude ? parseFloat(venue.location.longitude) : null;
  const lat = venue?.location?.latitude ? parseFloat(venue.location.latitude) : null;

  const price = e.priceRanges?.[0];
  const categories = (e.classifications ?? [])
    .flatMap((c) => [c.segment?.name, c.genre?.name, c.subGenre?.name])
    .filter((s): s is string => !!s && s !== 'Undefined');

  // Pick a 16:9 image around 640w as a reasonable default; fall back to first.
  const image =
    e.images?.find((img) => img.ratio === '16_9' && img.width >= 600 && img.width <= 800) ??
    e.images?.[0];

  return {
    sourceEventId: e.id,
    title: e.name,
    description: e.info ?? e.pleaseNote ?? null,
    startAt: new Date(startIso),
    endAt: e.dates?.end?.dateTime ? new Date(e.dates.end.dateTime) : null,
    timezone: e.dates?.timezone ?? null,
    venueName: venue?.name ?? null,
    address: venue?.address?.line1 ?? null,
    city: venue?.city?.name ?? null,
    region: venue?.state?.stateCode ?? venue?.state?.name ?? null,
    country: venue?.country?.countryCode ?? null,
    location: lng != null && lat != null ? { lng, lat } : null,
    ageMin: null,
    ageMax: null,
    costMinCents: price?.min != null ? Math.round(price.min * 100) : null,
    costMaxCents: price?.max != null ? Math.round(price.max * 100) : null,
    currency: price?.currency ?? null,
    availability: mapStatus(e.dates?.status?.code),
    url: e.url ?? null,
    imageUrl: image?.url ?? null,
    categories: categories.length > 0 ? categories : null,
    raw: e,
  };
}

function mapStatus(code: string | undefined): NormalizedActivity['availability'] {
  switch (code) {
    case 'onsale':
      return 'onsale';
    case 'offsale':
      return 'sold_out';
    case 'cancelled':
      return 'cancelled';
    case 'rescheduled':
    case 'postponed':
    default:
      return 'unknown';
  }
}

// ---- Ticketmaster API response types (only the fields we use) ----

interface TmResponse {
  _embedded?: { events?: TmEvent[] };
  page?: { totalPages?: number };
}

interface TmEvent {
  id: string;
  name: string;
  url?: string;
  info?: string;
  pleaseNote?: string;
  dates?: {
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    timezone?: string;
    status?: { code?: string };
  };
  images?: Array<{ url: string; ratio?: string; width: number; height: number }>;
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
  }>;
  _embedded?: {
    venues?: Array<{
      name?: string;
      address?: { line1?: string };
      city?: { name?: string };
      state?: { name?: string; stateCode?: string };
      country?: { countryCode?: string };
      location?: { latitude?: string; longitude?: string };
    }>;
  };
}
