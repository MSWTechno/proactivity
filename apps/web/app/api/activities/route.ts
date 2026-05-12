import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { categorize, ALL_CATEGORY_KEYS, type CategoryKey } from '@/lib/categories';

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
  cost_min_cents: number | null;
  cost_max_cents: number | null;
  currency: string | null;
  availability: string;
  url: string | null;
  image_url: string | null;
  categories: string[] | null;
  lng: number | null;
  lat: number | null;
  distance_m: number | null;
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

  const hasUserLocation = lat != null && lng != null;
  const effectiveSort = sort === 'distance' && !hasUserLocation ? 'time' : sort;

  // postgres-js sql fragments — composable and parameterized.
  const distanceExpr = hasUserLocation
    ? sql`ST_Distance(location::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)`
    : sql`NULL::float8`;

  const availabilityFilter = includeUnavailable
    ? sql``
    : sql`AND availability IN ('onsale','free','dropin')`;

  const radiusFilter = hasUserLocation
    ? sql`AND ST_DWithin(
            location::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
            ${radiusKm * 1000}
          )`
    : sql``;

  const costFilter = freeOnly
    ? sql`AND (cost_min_cents = 0 OR availability = 'free')`
    : maxCostCents != null
      ? sql`AND (cost_min_cents IS NULL OR cost_min_cents <= ${maxCostCents})`
      : sql``;

  const orderClause =
    effectiveSort === 'distance'
      ? sql`ORDER BY distance_m ASC NULLS LAST`
      : effectiveSort === 'cost'
        ? sql`ORDER BY cost_min_cents ASC NULLS LAST`
        : sql`ORDER BY start_at ASC`;

  const rows = (await sql`
    SELECT
      id, title, description, start_at, end_at, timezone,
      venue_name, city, region,
      cost_min_cents, cost_max_cents, currency, availability,
      url, image_url, categories,
      ST_X(location) AS lng,
      ST_Y(location) AS lat,
      ${distanceExpr} AS distance_m
    FROM activities
    WHERE start_at >= now()
      AND start_at <= now() + (${daysAhead}::int * interval '1 day')
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
    };
  });

  const filtered = mapped.filter((item) => {
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
