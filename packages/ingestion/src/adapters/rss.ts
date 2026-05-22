import type {
  NormalizedActivity,
  SourceAdapter,
  FetchContext,
  ParseConfigResult,
} from '../types.js';

/**
 * Generic RSS 2.0 adapter for event-bearing RSS feeds. Use when a source
 * exposes only RSS (no iCal, no JSON-LD, no JSON API) — JMU's EMS Master
 * Calendar is the motivating example. Each <item>'s pubDate is treated
 * as the event start (this is the convention EMS, Tockify, and most
 * calendar RSS exporters use; classic "blog post date" RSS feeds will
 * mis-import, which is fine because we'd never wire one as a source).
 */
interface RssConfig {
  url: string;
  lat: number;
  lng: number;
  /** Default availability — RSS carries no ticketing signal. */
  defaultAvailability?: NormalizedActivity['availability'];
  /** Used as start + N minutes when no end time is exposed. */
  defaultDurationMinutes?: number;
  /** Stamped on every event for venue context. */
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

function isRssConfig(v: unknown): v is RssConfig {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.url === 'string' &&
    typeof c.lat === 'number' &&
    typeof c.lng === 'number'
  );
}

/**
 * Strip CDATA wrappers and basic HTML — RSS items often arrive as
 * `<![CDATA[<p>...</p>]]>`. We want plain text in description.
 */
function clean(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Minimal RSS 2.0 item parser — regex-based to avoid pulling in a full
 * XML parser for this one shape. Works for the canonical `<channel><item>`
 * structure that EMS / Tockify / WordPress all emit.
 */
function parseItems(xml: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(xml)) !== null) {
    const body = im[1]!;
    const fields: Record<string, string> = {};
    // Tag children we care about. enclosure is self-closing with attrs.
    const tagRe = /<(title|description|link|guid|pubDate|category|author)\b[^>]*>([\s\S]*?)<\/\1>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tagRe.exec(body)) !== null) {
      const k = tm[1]!;
      // Keep the first category only — many feeds emit several and we
      // don't currently carry a multi-category field on NormalizedActivity.
      if (k === 'category' && fields.category) continue;
      fields[k] = tm[2]!;
    }
    const encMatch = /<enclosure\b[^>]*url="([^"]+)"/i.exec(body);
    if (encMatch) fields.enclosure = encMatch[1]!;
    items.push(fields);
  }
  return items;
}

export const rssAdapter: SourceAdapter = {
  key: 'rss',
  configHelp:
    '<url> <lat> <lng> [defaultAvailability=free] [defaultDurationMinutes=120]',

  parseCliConfig(args: string[]): ParseConfigResult {
    if (args.length < 3 || args.length > 5) {
      return {
        ok: false,
        error: 'expected <url> <lat> <lng> [defaultAvailability] [defaultDurationMinutes]',
      };
    }
    const [url, latStr, lngStr, availStr, durStr] = args as [
      string, string, string, string?, string?,
    ];
    try { new URL(url); } catch { return { ok: false, error: `invalid url: "${url}"` }; }
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: 'lat must be in [-90, 90]' };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: 'lng must be in [-180, 180]' };
    const availability = (availStr ?? 'free') as NormalizedActivity['availability'];
    if (!ALLOWED_AVAILABILITY.includes(availability)) {
      return { ok: false, error: `defaultAvailability must be one of ${ALLOWED_AVAILABILITY.join('|')}` };
    }
    const duration = durStr ? Number(durStr) : 120;
    if (!Number.isFinite(duration) || duration < 1 || duration > 24 * 60) {
      return { ok: false, error: 'defaultDurationMinutes must be in [1, 1440]' };
    }
    return {
      ok: true,
      config: { url, lat, lng, defaultAvailability: availability, defaultDurationMinutes: duration },
    };
  },

  async *fetch({ config, signal }: FetchContext): AsyncIterable<NormalizedActivity> {
    if (!isRssConfig(config)) {
      throw new Error('rss adapter: config must be { url, lat, lng, ... }');
    }
    const res = await fetch(config.url, {
      headers: {
        'User-Agent': 'Proactivity/0.1 (+https://proactivity.app)',
        Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
      },
      signal,
    });
    if (!res.ok) throw new Error(`rss fetch ${res.status}: ${res.statusText}`);
    const xml = await res.text();
    if (!/<rss\b|<feed\b/i.test(xml)) {
      throw new Error(
        `response from ${config.url} is not RSS/Atom (got ${res.headers.get('content-type') ?? 'unknown'})`,
      );
    }

    const durationMs = (config.defaultDurationMinutes ?? 120) * 60_000;
    for (const item of parseItems(xml)) {
      const title = clean(item.title);
      const link = clean(item.link);
      const guid = clean(item.guid) || link;
      const pubDateRaw = clean(item.pubDate);
      if (!title || !guid || !pubDateRaw) continue;
      const startAt = new Date(pubDateRaw);
      if (isNaN(startAt.getTime())) continue;

      yield {
        sourceEventId: guid,
        title,
        description: clean(item.description) || null,
        startAt,
        endAt: new Date(startAt.getTime() + durationMs),
        venueName: config.defaultVenue ?? null,
        city: config.defaultCity ?? null,
        region: config.defaultRegion ?? null,
        country: 'US',
        location: { lat: config.lat, lng: config.lng },
        availability: config.defaultAvailability ?? 'free',
        organizerName: config.defaultOrganizerName ?? null,
        organizerUrl: config.defaultOrganizerUrl ?? null,
        url: link || null,
        imageUrl: item.enclosure ?? null,
        categories: item.category ? [clean(item.category)] : null,
        raw: item,
      };
    }
  },
};
