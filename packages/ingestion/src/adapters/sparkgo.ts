import type {
  NormalizedActivity,
  SourceAdapter,
  FetchContext,
  ParseConfigResult,
} from '../types.js';
import { throttledFetch } from '../http.js';

/**
 * SparkGo hospitality-calendar adapter.
 *
 * SparkGo (`<client>.sparkgo.co`) powers the "what's on today" calendars that
 * resorts embed in their marketing sites. Massanutten Resort is the motivating
 * source: its calendar page carries no JSON-LD, no iCal and no RSS — the events
 * only arrive client-side from a SparkGo REST endpoint, so none of the existing
 * adapters can see them.
 *
 * The endpoint is public (no key; a Referer is enough) and strictly one day per
 * request:
 *
 *   GET {baseUrl}/api/v1/ext/embed/{embedId}/data?date=YYYY-MM-DD
 *
 * Without `date` it returns `code: 10` and empty collections, which reads like
 * a broken endpoint rather than a missing parameter. `?start=/?end=` are
 * ignored and `?days=` 500s — so we walk the window a day at a time.
 *
 * IMPORTANT — why `attributes` filtering is not optional in practice:
 * a resort calendar is mostly amenity programming for paying guests (Open Swim,
 * Lap Swim, Horseback Trail Rides, escape rooms). Sampling Massanutten over 90
 * days gave 546 rows from only 79 distinct titles, ~90% of it recurring
 * amenities that would bury genuinely public events in a last-minute local
 * feed. Each event does carry `attributeIds` resolving to names like
 * "Live Music", "Entertainment", "Dining Events", "Arts & Crafts" — so callers
 * pass an allowlist and we keep only what a non-guest could plausibly turn up
 * to. Note `isPriced` is useless as a signal here: it was false on all 546 rows
 * despite many activities costing money.
 */
interface SparkgoConfig {
  /** Origin of the SparkGo tenant, e.g. "https://massanutten.sparkgo.co". */
  baseUrl: string;
  /** Embed id from the host page's `data-url` attribute. */
  embedId: string;
  lat: number;
  lng: number;
  /** Days of calendar to walk, starting today. One request each. */
  daysAhead?: number;
  /** IANA zone the resort publishes wall-clock times in. */
  timezone?: string;
  /**
   * Attribute names to keep (case-insensitive). Empty/omitted means keep
   * everything, which for a resort calendar is almost never what you want.
   */
  attributes?: string[];
  /**
   * Attribute names to drop even when they matched the allowlist, applied
   * second. Needed because the allowlist buckets are coarse: at Massanutten
   * "Entertainment" also carries the twice-daily escape-room sessions, which
   * are bookable amenities rather than events and were 20 of 67 kept rows
   * over a 14-day window. Excluding "Escape Rooms & VR" removes them without
   * resorting to title matching.
   */
  excludeAttributes?: string[];
  /** Sent as Referer — the endpoint expects the embedding site. */
  refererUrl?: string;
  /** Fallback when an event exposes no call-to-action link. */
  fallbackUrl?: string;
  defaultAvailability?: NormalizedActivity['availability'];
  defaultVenue?: string | null;
  defaultCity?: string | null;
  defaultRegion?: string | null;
  defaultOrganizerName?: string | null;
  defaultOrganizerUrl?: string | null;
}

const ALLOWED_AVAILABILITY: NormalizedActivity['availability'][] = [
  'onsale',
  'free',
  'dropin',
  'unknown',
];

/** Shapes we rely on from the SparkGo payload. Everything else is passed through as `raw`. */
interface SparkgoEvent {
  id?: string;
  templateId?: string;
  title?: string;
  description?: string;
  venueString?: string;
  startTime?: { hour?: number; minute?: number };
  duration?: number;
  attributeIds?: string[];
  segmentId?: string;
  images?: Array<{ url?: string }>;
  callToActions?: Array<{ link?: string; label?: string }>;
}

function isSparkgoConfig(v: unknown): v is SparkgoConfig {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.baseUrl === 'string' &&
    typeof c.embedId === 'string' &&
    typeof c.lat === 'number' &&
    typeof c.lng === 'number'
  );
}

/**
 * Offset of `tz` from UTC at a given instant, in ms. Derived by formatting the
 * instant in that zone and reading the wall clock back — avoids a tz library
 * and stays correct across DST because it is evaluated per instant.
 */
function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Some ICU builds render midnight as hour 24.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

/**
 * Convert a wall-clock time in `tz` to a UTC Date. Applied twice because the
 * first correction can land on the other side of a DST transition, which
 * changes the offset that should have been used.
 */
function zonedTimeToUtc(dateStr: string, hour: number, minute: number, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute);
  let utc = naive - tzOffsetMs(new Date(naive), tz);
  utc = naive - tzOffsetMs(new Date(utc), tz);
  const d = new Date(utc);
  return isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD for `daysFromToday`, as the calendar's own local date. */
function localDateStr(daysFromToday: number, tz: string): string {
  const at = new Date(Date.now() + daysFromToday * 86_400_000);
  // en-CA renders ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * Templated titles occasionally ship with their placeholder unfilled — the
 * Massanutten feed carries "Live Music featuring $NAME$" on days where the act
 * hasn't been entered yet. Publishing that verbatim looks broken, so drop it.
 */
function hasUnfilledPlaceholder(title: string): boolean {
  return /\$[A-Za-z0-9_]+\$|\{\{.*?\}\}/.test(title);
}

export const sparkgoAdapter: SourceAdapter = {
  key: 'sparkgo',
  configHelp:
    '<baseUrl> <embedId> <lat> <lng> [attributesCsv] [daysAhead=7] [defaultAvailability=dropin]',

  parseCliConfig(args: string[]): ParseConfigResult {
    if (args.length < 4 || args.length > 7) {
      return {
        ok: false,
        error:
          'expected <baseUrl> <embedId> <lat> <lng> [attributesCsv] [daysAhead] [defaultAvailability]',
      };
    }
    const [baseUrl, embedId, latStr, lngStr, attrsStr, daysStr, availStr] = args as [
      string, string, string, string, string?, string?, string?,
    ];
    // excludeAttributes is intentionally not a positional CLI arg — it is set
    // on sources.config directly, since it needs the source's real attribute
    // vocabulary in hand to be worth writing.
    let origin: string;
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      return { ok: false, error: `invalid baseUrl: "${baseUrl}"` };
    }
    if (!/^[a-f0-9]{12,}$/i.test(embedId)) {
      return { ok: false, error: `embedId looks wrong: "${embedId}" (expected a hex id)` };
    }
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: 'lat must be in [-90, 90]' };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: 'lng must be in [-180, 180]' };

    const attributes = (attrsStr ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const daysAhead = daysStr ? Number(daysStr) : 7;
    if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 60) {
      return { ok: false, error: 'daysAhead must be an integer in [1, 60] (one request per day)' };
    }
    const availability = (availStr ?? 'dropin') as NormalizedActivity['availability'];
    if (!ALLOWED_AVAILABILITY.includes(availability)) {
      return { ok: false, error: `defaultAvailability must be one of ${ALLOWED_AVAILABILITY.join('|')}` };
    }
    return {
      ok: true,
      config: { baseUrl: origin, embedId, lat, lng, attributes, daysAhead, defaultAvailability: availability },
    };
  },

  async *fetch({ config, signal }: FetchContext): AsyncIterable<NormalizedActivity> {
    if (!isSparkgoConfig(config)) {
      throw new Error('sparkgo adapter: config must be { baseUrl, embedId, lat, lng, ... }');
    }
    const tz = config.timezone ?? 'America/New_York';
    const daysAhead = config.daysAhead ?? 7;
    const allow = new Set((config.attributes ?? []).map((a) => a.toLowerCase()));
    const deny = new Set((config.excludeAttributes ?? []).map((a) => a.toLowerCase()));
    const durationFallbackMs = 60 * 60_000;

    let kept = 0;
    let filtered = 0;
    let excluded = 0;
    let skippedPlaceholder = 0;

    for (let i = 0; i < daysAhead; i++) {
      if (signal?.aborted) return;
      const date = localDateStr(i, tz);
      const url = `${config.baseUrl}/api/v1/ext/embed/${config.embedId}/data?date=${date}`;

      const res = await throttledFetch(url, {
        signal,
        headers: {
          'User-Agent': 'Proactivity/0.1 (+https://proactivity.app)',
          Accept: 'application/json',
          // The endpoint serves an embed; send the embedding site as referer.
          ...(config.refererUrl ? { Referer: config.refererUrl } : {}),
        },
      });
      if (!res.ok) throw new Error(`sparkgo fetch ${res.status} for ${date}: ${res.statusText}`);

      const body = (await res.json()) as {
        lineup?: Array<{ date?: string; events?: SparkgoEvent[] }>;
        collections?: { attributes?: Array<{ _id?: string; name?: string }> };
      };

      // Attribute ids are opaque; the payload ships its own id -> name table.
      const attrNames = new Map<string, string>();
      for (const a of body.collections?.attributes ?? []) {
        if (a._id && a.name) attrNames.set(a._id, a.name);
      }

      for (const day of body.lineup ?? []) {
        for (const ev of day.events ?? []) {
          const title = (ev.title ?? '').trim();
          if (!title) continue;
          if (hasUnfilledPlaceholder(title)) {
            skippedPlaceholder++;
            continue;
          }

          const names = (ev.attributeIds ?? [])
            .map((id) => attrNames.get(id))
            .filter((n): n is string => Boolean(n));
          if (allow.size > 0 && !names.some((n) => allow.has(n.toLowerCase()))) {
            filtered++;
            continue;
          }
          if (deny.size > 0 && names.some((n) => deny.has(n.toLowerCase()))) {
            excluded++;
            continue;
          }

          const hour = ev.startTime?.hour;
          const minute = ev.startTime?.minute ?? 0;
          if (typeof hour !== 'number') continue;
          const startAt = zonedTimeToUtc(day.date ?? date, hour, minute, tz);
          if (!startAt) continue;
          const endAt = new Date(
            startAt.getTime() + (ev.duration ? ev.duration * 60_000 : durationFallbackMs),
          );

          // Prefer an explicit "learn more"-style link, else the first CTA,
          // else the configured fallback. Rows with no url are dropped by the
          // feed query, so a source with no fallback silently ingests nothing.
          const ctas = (ev.callToActions ?? []).filter((c) => c.link);
          const preferred =
            ctas.find((c) => /learn|more|info|detail/i.test(c.label ?? ''))?.link ??
            ctas[0]?.link ??
            config.fallbackUrl ??
            null;

          // Occurrence key built from stable fields rather than the payload's
          // `id`: templateId + local date + start time is reproducible, so a
          // re-run updates the same row even if SparkGo reissues ids.
          const occurrenceKey = `${ev.templateId ?? ev.id ?? title}:${day.date ?? date}:${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;

          kept++;
          yield {
            sourceEventId: occurrenceKey,
            title,
            description: (ev.description ?? '').trim() || null,
            startAt,
            endAt,
            timezone: tz,
            venueName: ev.venueString?.trim() || config.defaultVenue || null,
            city: config.defaultCity ?? null,
            region: config.defaultRegion ?? null,
            country: 'US',
            location: { lat: config.lat, lng: config.lng },
            availability: config.defaultAvailability ?? 'dropin',
            organizerName: config.defaultOrganizerName ?? null,
            organizerUrl: config.defaultOrganizerUrl ?? null,
            url: preferred,
            imageUrl: ev.images?.find((im) => im.url)?.url ?? null,
            categories: names.length > 0 ? names : null,
            raw: ev,
          };
        }
      }
    }

    // Never let the allowlist drop everything silently — a renamed attribute
    // upstream would otherwise look like "the resort has no events".
    console.log(
      `[sparkgo] ${config.embedId}: kept ${kept}, filtered ${filtered} by allowlist, ` +
        `${excluded} by exclude list, skipped ${skippedPlaceholder} with unfilled ` +
        `title placeholders (${daysAhead}d)`,
    );
    if (kept === 0 && filtered > 0) {
      console.warn(
        `[sparkgo] allowlist [${[...allow].join(', ')}] matched nothing across ${daysAhead} days — ` +
          'check whether the source renamed its attributes',
      );
    }
  },
};
