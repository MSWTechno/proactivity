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
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams;

  const lat = parseNum(q.get('lat'));
  const lng = parseNum(q.get('lng'));
  const radiusKm = parseNum(q.get('radiusKm')) ?? 25;
  const daysAhead = clampInt(parseNum(q.get('daysAhead')) ?? 7, 1, 90);
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

  const orderClause =
    effectiveSort === 'distance'
      ? sql`ORDER BY distance_m ASC NULLS LAST`
      : effectiveSort === 'cost'
        ? sql`ORDER BY a.cost_min_cents ASC NULLS LAST`
        : sql`ORDER BY a.start_at ASC`;

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
      COALESCE(org_r.cnt, 0)::int AS organizer_rating_count
    FROM activities a
    LEFT JOIN LATERAL (
      SELECT AVG(score)::float8 AS avg_score, COUNT(*)::int AS cnt
      FROM ratings
      WHERE target_kind = 'event'
        AND source_id = a.source_id
        AND target_key = SPLIT_PART(a.source_event_id, '::', 1)
        AND status = 'approved'
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT AVG(score)::float8 AS avg_score, COUNT(*)::int AS cnt
      FROM ratings
      WHERE target_kind = 'organizer'
        AND target_key = a.organizer_key
        AND a.organizer_key IS NOT NULL
        AND status = 'approved'
    ) org_r ON true
    WHERE a.start_at >= now()
      AND a.start_at <= now() + (${daysAhead}::int * interval '1 day')
      ${availabilityFilter}
      ${radiusFilter}
      ${costFilter}
    ${orderClause}
    LIMIT ${pageSize} OFFSET ${page * pageSize}
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
      startAt: r.start_at,
      endAt: r.end_at,
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
      organizer: r.organizer_key
        ? {
            name: r.organizer_name,
            url: r.organizer_url,
            key: r.organizer_key,
            ratingAverage: r.organizer_rating_average,
            ratingCount: r.organizer_rating_count,
          }
        : null,
    };
  });

  const filtered = mapped.filter((item) => {
    if (!includeVirtual && (item.isVirtual || isVirtualEvent(item))) return false;
    if (requestedCategories.length > 0) {
      const hit = item.canonicalCategories.some((c) => requestedCategories.includes(c));
      if (!hit) return false;
    }
    if (search) {
      const hay = `${item.title} ${item.description ?? ''} ${item.venueName ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  return NextResponse.json({
    items: filtered,
    page,
    pageSize,
    total: filtered.length,
  });
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
