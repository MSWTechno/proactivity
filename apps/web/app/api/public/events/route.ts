import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { authenticate } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/public/events
 *
 * Partner-facing public API. Returns a simplified, stable event shape
 * for use on external sites (lake-anna-guide, lodging sites, tourism
 * partners, etc.). Versioned via the `?v=` param — only `v=1` is live.
 *
 * Auth: API key via `Authorization: Bearer <key>` or `?key=<key>`.
 * Keys are minted by an admin at /admin/api-keys.
 *
 * Query params:
 *   lat, lng       - decimal degrees; required together
 *   radiusMi       - integer, 1..200 (default 25). Converted to km on
 *                    the wire for the existing /api/activities backend.
 *   days           - integer, 1..90 (default 7). Window of future days.
 *   limit          - integer, 1..100 (default 50).
 *   categories     - comma-separated canonical category keys (optional)
 *
 * CORS: allows any origin so embeds work from any domain that has a
 * valid key. The key gating is what protects the data, not the origin.
 */
export async function GET(request: Request) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };

  const auth = await authenticate(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: cors });
  }

  const url = new URL(request.url);
  const v = url.searchParams.get('v') ?? '1';
  if (v !== '1') {
    return NextResponse.json({ error: 'unknown version (only v=1 supported)' }, { status: 400, headers: cors });
  }

  const lat = parseFloat(url.searchParams.get('lat') ?? '');
  const lng = parseFloat(url.searchParams.get('lng') ?? '');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'lat and lng required (decimal degrees)' }, { status: 400, headers: cors });
  }

  const radiusMi = clamp(parseInt(url.searchParams.get('radiusMi') ?? '25', 10), 1, 200, 25);
  const radiusKm = radiusMi * 1.60934;
  const days = clamp(parseInt(url.searchParams.get('days') ?? '7', 10), 1, 90, 7);
  const limit = clamp(parseInt(url.searchParams.get('limit') ?? '50', 10), 1, 100, 50);
  const categoryFilter = (url.searchParams.get('categories') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Query the same data the homepage uses, but pre-filter on the SQL
  // side for speed since partners don't need the post-fetch category
  // re-derivation we do for the canonical homepage.
  const rows = (await sql`
    SELECT
      a.id, a.title, a.description, a.start_at, a.end_at, a.timezone,
      a.url, a.image_url,
      a.venue_name, a.address, a.city, a.region,
      a.cost_min_cents, a.cost_max_cents, a.currency, a.availability,
      a.organizer_name, a.organizer_url,
      a.categories,
      ST_X(a.location::geometry) AS lng,
      ST_Y(a.location::geometry) AS lat,
      ST_DistanceSphere(
        a.location::geometry,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
      ) AS distance_m
    FROM activities a
    WHERE a.url IS NOT NULL
      AND a.url <> ''
      AND a.is_virtual = false
      AND a.start_at >= now()
      AND a.start_at <= now() + (${days}::int * interval '1 day')
      AND ST_DWithin(
        a.location::geography,
        ST_MakePoint(${lng}, ${lat})::geography,
        ${radiusKm * 1000}
      )
    ORDER BY a.start_at ASC
    LIMIT ${limit}
  `) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    start_at: Date;
    end_at: Date | null;
    timezone: string | null;
    url: string;
    image_url: string | null;
    venue_name: string | null;
    address: string | null;
    city: string | null;
    region: string | null;
    cost_min_cents: number | null;
    cost_max_cents: number | null;
    currency: string | null;
    availability: string;
    organizer_name: string | null;
    organizer_url: string | null;
    categories: string[] | null;
    lng: number;
    lat: number;
    distance_m: number;
  }>;

  const events = rows
    .filter((r) => {
      if (categoryFilter.length === 0) return true;
      const cats = (r.categories ?? []).map((c) => c.toLowerCase());
      return categoryFilter.some((c) => cats.includes(c.toLowerCase()));
    })
    .map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      startAt: r.start_at,
      endAt: r.end_at,
      timezone: r.timezone,
      url: r.url,
      imageUrl: r.image_url,
      venueName: r.venue_name,
      address: r.address,
      city: r.city,
      region: r.region,
      costMinCents: r.cost_min_cents,
      costMaxCents: r.cost_max_cents,
      currency: r.currency,
      availability: r.availability,
      organizerName: r.organizer_name,
      organizerUrl: r.organizer_url,
      categories: r.categories,
      location: { lat: r.lat, lng: r.lng },
      distanceMeters: Math.round(r.distance_m),
    }));

  return NextResponse.json(
    {
      version: 1,
      count: events.length,
      query: { lat, lng, radiusMi, days, limit, categories: categoryFilter },
      events,
      attribution: { name: 'Proactivity', url: 'https://proactivity.app' },
    },
    { headers: cors },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
