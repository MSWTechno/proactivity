import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { categorize, ALL_CATEGORY_KEYS, type CategoryKey } from '@/lib/categories';
import { inferAgeRange } from '@/lib/age';

export const dynamic = 'force-dynamic';

interface ActivityRow {
  id: string;
  title: string;
  description: string | null;
  start_at: Date;
  end_at: Date | null;
  timezone: string | null;
  venue_name: string | null;
  city: string | null;
  region: string | null;
  age_min: number | null;
  age_max: number | null;
  is_virtual: boolean;
  cost_min_cents: number | null;
  cost_max_cents: number | null;
  currency: string | null;
  availability: string;
  url: string | null;
  image_url: string | null;
  categories: string[] | null;
  organizer_name: string | null;
  organizer_url: string | null;
  organizer_key: string | null;
  lng: number | null;
  lat: number | null;
  distance_m: number | null;
  rating_average: number | null;
  rating_count: number;
  organizer_rating_average: number | null;
  organizer_rating_count: number;
  is_featured: boolean;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams;

  const lat = parseNum(q.get('lat'));
  const lng = parseNum(q.get('lng'));
  const radiusKm = parseNum(q.get('radiusKm')) ?? 25;
  // `daysAhead=all` disables the upper bound; `daysAhead=past` flips the
  // query to events whose start_at is in the past (last 90 days), sorted
  // newest-first. Anything else is a positive day window.
  const daysAheadRaw = q.get('daysAhead');
  const isPast = daysAheadRaw === 'past';
  const daysAheadNum = parseNum(daysAheadRaw);
  const daysAhead =
    isPast || daysAheadRaw === 'all' || daysAheadNum == null
      ? null
      : clampInt(daysAheadNum, 1, 365);
  const maxCostCents = parseNum(q.get('maxCostCents'));
  const freeOnly = q.get('freeOnly') === '1';
  const includeUnavailable = q.get('includeUnavailable') === '1';
  const sort = (q.get('sort') ?? 'distance') as 'distance' | 'time' | 'cost';
  const page = Math.max(0, Math.floor(parseNum(q.get('page')) ?? 0));
  const pageSize = clampInt(parseNum(q.get('pageSize')) ?? 50, 1, 100);
  const search = q.get('search')?.trim().toLowerCase() ?? '';
  const categoryParam = q.get('category')?.trim() ?? '';
  const requestedCategories = categoryParam
    ? categoryParam
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is CategoryKey => ALL_CATEGORY_KEYS.includes(s as CategoryKey))
    : [];
  const includeVirtual = q.get('includeVirtual') === '1';

  const hasUserLocation = lat != null && lng != null;
  const effectiveSort = sort === 'distance' && !hasUserLocation ? 'time' : sort;

  // postgres-js sql fragments — composable and parameterized.
  const distanceExpr = hasUserLocation
    ? sql`ST_Distance(a.location::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)`
    : sql`NULL::float8`;

  const availabilityFilter = includeUnavailable
    ? sql``
    : sql`AND a.availability IN ('onsale','free','dropin')`;

  const radiusFilter = hasUserLocation
    ? sql`AND ST_DWithin(
            a.location::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
            ${radiusKm * 1000}
          )`
    : sql``;

  const costFilter = freeOnly
    ? sql`AND (a.cost_min_cents = 0 OR a.availability = 'free')`
    : maxCostCents != null
      ? sql`AND (a.cost_min_cents IS NULL OR a.cost_min_cents <= ${maxCostCents})`
      : sql``;

  // Search is filtered in SQL (before LIMIT) so it spans the whole result set,
  // not just the first page. Matches title, description, venue, and organizer
  // name — the same fields the post-fetch filter used to check. ILIKE on a
  // concatenation keeps it simple; the row counts here don't warrant FTS.
  const searchFilter = search
    ? sql`AND (
            a.title || ' ' || COALESCE(a.description, '') || ' ' ||
            COALESCE(a.venue_name, '') || ' ' || COALESCE(a.organizer_name, '')
          ) ILIKE ${'%' + search + '%'}`
    : sql``;

  // Filter out virtual events in SQL (before LIMIT) via the stored flag, so a
  // page isn't under-filled when virtual events sort into it. The isVirtualEvent
  // text heuristic in the post-fetch step is a light supplement for rows whose
  // flag is null/missed. `IS NOT TRUE` keeps NULL (unknown) rows visible.
  const virtualFilter = includeVirtual ? sql`` : sql`AND a.is_virtual IS NOT TRUE`;

  // Featured (paying organizer) events bubble to the top regardless of sort.
  // Past mode forces newest-first chronological order — the other sort modes
  // don't really make sense looking backwards.
  const orderClause = isPast
    ? sql`ORDER BY is_featured DESC, a.start_at DESC`
    : effectiveSort === 'distance'
      ? sql`ORDER BY is_featured DESC, distance_m ASC NULLS LAST`
      : effectiveSort === 'cost'
        ? sql`ORDER BY is_featured DESC, a.cost_min_cents ASC NULLS LAST`
        : sql`ORDER BY is_featured DESC, a.start_at ASC`;

  // Category is a *derived* field (computed by categorize() at response time
  // from raw categories + title/description), so it can't be filtered in SQL
  // before the LIMIT the way search is. If we paginate in SQL first and filter
  // by category after, a rare category (e.g. a handful of VBS events sorted far
  // down) never appears on page 1 and the filter returns nothing. So when a
  // category is requested, fetch the whole candidate set (capped) and do the
  // category filter + pagination in JS below. Same recall fix the search filter
  // got, adapted for a derived field.
  const categoryActive = requestedCategories.length > 0;
  const CATEGORY_FETCH_CAP = 2000;
  const sqlLimit = categoryActive ? CATEGORY_FETCH_CAP : pageSize;
  const sqlOffset = categoryActive ? 0 : page * pageSize;

  const rows = (await sql`
    SELECT
      a.id, a.title, a.description, a.start_at, a.end_at, a.timezone,
      a.venue_name, a.city, a.region,
      a.age_min, a.age_max,
      a.is_virtual,
      a.cost_min_cents, a.cost_max_cents, a.currency, a.availability,
      a.url, a.image_url, a.categories,
      a.organizer_name, a.organizer_url, a.organizer_key,
      ST_X(a.location) AS lng,
      ST_Y(a.location) AS lat,
      ${distanceExpr} AS distance_m,
      r.avg_score AS rating_average,
      COALESCE(r.cnt, 0)::int AS rating_count,
      org_r.avg_score AS organizer_rating_average,
      COALESCE(org_r.cnt, 0)::int AS organizer_rating_count,
      COALESCE(feat.is_featured, false) AS is_featured
    FROM activities a
    LEFT JOIN LATERAL (
      SELECT AVG(score)::float8 AS avg_score, COUNT(*)::int AS cnt
      FROM ratings
      WHERE target_kind = 'event'
        AND source_id = a.source_id
        AND target_key = SPLIT_PART(a.source_event_id, '::', 1)
        AND status = 'approved'
    ) r ON true
    -- Drop events with no canonical URL — they'd render as dead "#" links.
    LEFT JOIN LATERAL (
      SELECT AVG(score)::float8 AS avg_score, COUNT(*)::int AS cnt
      FROM ratings
      WHERE target_kind = 'organizer'
        AND target_key = a.organizer_key
        AND a.organizer_key IS NOT NULL
        AND status = 'approved'
    ) org_r ON true
    -- Featured = an approved organizer_claim user has an active
    -- organizer_pro subscription for this organizer_key.
    LEFT JOIN LATERAL (
      SELECT true AS is_featured
      FROM organizer_claims c
      JOIN subscriptions s ON s.user_id = c.user_id
      WHERE c.organizer_key = a.organizer_key
        AND a.organizer_key IS NOT NULL
        AND c.status = 'approved'
        AND s.kind = 'organizer_pro'
        AND s.status IN ('active', 'trialing')
      LIMIT 1
    ) feat ON true
    WHERE a.url IS NOT NULL AND a.url <> ''
      ${isPast
        ? sql`AND COALESCE(a.end_at, a.start_at) < now() AND a.start_at >= now() - interval '90 days'`
        : sql`AND COALESCE(a.end_at, a.start_at) >= now()`}
      ${daysAhead != null
        ? sql`AND a.start_at <= now() + (${daysAhead}::int * interval '1 day')`
        : sql``}
      ${availabilityFilter}
      ${radiusFilter}
      ${costFilter}
      ${searchFilter}
      ${virtualFilter}
    ${orderClause}
    LIMIT ${sqlLimit} OFFSET ${sqlOffset}
  `) as unknown as ActivityRow[];

  // Derive canonical categories per row, then filter by search + category.
  const mapped = rows.map((r) => {
    const canonical = categorize({
      rawCategories: r.categories,
      title: r.title,
      description: r.description,
      venueName: r.venue_name,
    });
    const ageRange = inferAgeRange({
      title: r.title,
      description: r.description,
      ageMin: r.age_min,
      ageMax: r.age_max,
    });
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      // Emit strict ISO 8601. postgres-js hands back timestamptz as a non-ISO
      // string ("YYYY-MM-DD HH:MM:SS+00"); V8 parses it but React Native's
      // Hermes engine returns Invalid Date, so the app showed "Invalid Date".
      startAt: toIso(r.start_at),
      endAt: r.end_at ? toIso(r.end_at) : null,
      timezone: r.timezone,
      venueName: r.venue_name,
      city: r.city,
      region: r.region,
      ageMin: r.age_min,
      ageMax: r.age_max,
      ageRange,
      isVirtual: r.is_virtual,
      costMinCents: r.cost_min_cents,
      costMaxCents: r.cost_max_cents,
      currency: r.currency,
      availability: r.availability,
      url: r.url,
      imageUrl: r.image_url,
      categories: r.categories,
      canonicalCategories: canonical,
      lng: r.lng,
      lat: r.lat,
      distanceMeters: r.distance_m,
      ratingAverage: r.rating_average,
      ratingCount: r.rating_count,
      // Surface the organizer object whenever the activity has any
      // organizer info, even if no organizer_key is set yet. Manual/
      // contact-form events often start with a name but no key (and
      // shouldn't hide the name from the card just because of that).
      // Org-reviews fetching is gated on key being non-null downstream.
      organizer: (r.organizer_key || r.organizer_name)
        ? {
            name: r.organizer_name,
            url: r.organizer_url,
            key: r.organizer_key,
            ratingAverage: r.organizer_rating_average,
            ratingCount: r.organizer_rating_count,
          }
        : null,
      isFeatured: r.is_featured,
    };
  });

  const filtered = mapped.filter((item) => {
    if (!includeVirtual && (item.isVirtual || isVirtualEvent(item))) return false;
    if (requestedCategories.length > 0) {
      // Default is OR (match any selected category). But when "camps" is one of
      // the selections, switch to AND so a second chip narrows *within* camps
      // (e.g. camps + sports = sports camps), which is what users expect when
      // drilling into a camp type. With a single category selected both modes
      // are equivalent.
      const andMode =
        requestedCategories.includes('camps') && requestedCategories.length > 1;
      const hit = andMode
        ? requestedCategories.every((c) => item.canonicalCategories.includes(c))
        : item.canonicalCategories.some((c) => requestedCategories.includes(c));
      if (!hit) return false;
    }
    return true;
  });

  // When category-filtering we fetched the whole candidate set, so paginate
  // the filtered result here. Otherwise SQL already applied LIMIT/OFFSET.
  const items = categoryActive
    ? filtered.slice(page * pageSize, page * pageSize + pageSize)
    : filtered;

  // Whether another page exists, for infinite scroll. Category-active: more of
  // the in-memory filtered set remains. Otherwise: SQL returned a full page of
  // raw rows (rows.length === pageSize), so there's likely another page —
  // the JS virtual heuristic may trim `items` below pageSize, so base this on
  // the raw row count, not on items.length.
  const hasMore = categoryActive
    ? (page + 1) * pageSize < filtered.length
    : rows.length === pageSize;

  return NextResponse.json({
    items,
    page,
    pageSize,
    total: filtered.length,
    hasMore,
  });
}

// Convert a DB timestamp (Date or postgres-js's non-ISO string) to strict ISO
// 8601 so every client — including React Native's strict Hermes engine — parses
// it. Falls back to the raw value if it somehow can't be parsed.
function toIso(v: Date | string): string {
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function parseNum(v: string | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Heuristic: does this look like a virtual/online event? Wants high recall on
 * actual virtual events while keeping false positives low. We DO exclude
 * "virtual reality" experiences (which are in-person but use the word).
 */
function isVirtualEvent(item: { title: string; description: string | null; venueName: string | null }): boolean {
  const title = item.title.toLowerCase();
  const desc = (item.description ?? '').toLowerCase();
  const venue = (item.venueName ?? '').toLowerCase();
  const all = `${title} ${desc} ${venue}`;

  // "virtual reality" is in-person — explicitly let those through.
  if (/\bvirtual\s+reality\b/.test(all)) return false;

  // Adverbial "virtually" is a strong signal (rarely used for in-person).
  if (/\bvirtually\b/.test(all)) return true;

  // Strong title signals: virtual/online/webinar/livestream in the title.
  if (/\b(virtual|online|webinar|livestream|live\s*stream)\b/.test(title)) return true;

  // "Join us online" / "join virtually" / "join the X virtually"
  if (/\bjoin\b[^.!?]{0,40}\b(online|virtually)\b/.test(desc)) return true;

  // "<virtual|online> <event-type>" pattern across all fields.
  if (/\b(virtual|online)\s+(event|meeting|class|workshop|tour|session|gathering|program|trivia|conference|webinar|series|launch|presentation|talk|seminar|lecture|chat|discussion|panel|hangout|meetup|book\s*club)\b/.test(all)) return true;

  // Standalone keywords that imply remote-only attendance.
  if (/\b(webinar|livestream|live\s*stream|streaming\s+(?:event|only)|broadcast(?:ing)?\s+(?:live|only))\b/.test(all)) return true;
  if (/\bzoom\s+(meeting|link|call|webinar|room)\b/.test(all)) return true;
  if (/\bvia\s+(zoom|google\s+meet|microsoft\s+teams|webex|youtube\s+live)\b/.test(all)) return true;
  if (/\bwatch\s+(?:online|live(?:\s+stream)?)\b/.test(all)) return true;
  if (/\btune\s+in\s+(online|live|virtually|remotely)\b/.test(all)) return true;
  if (/\b(remote-only|online-only)\b/.test(all)) return true;

  // Venue is explicitly online.
  if (item.venueName && /^\s*(online|virtual|webinar|zoom|youtube(\s+live)?|google\s+meet|teams)\s*$/i.test(item.venueName)) return true;

  return false;
}
