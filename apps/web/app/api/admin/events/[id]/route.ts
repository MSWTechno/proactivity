import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { requireAdmin } from '@/lib/admin-auth';
import { isSafeHttpUrl } from '@/lib/url';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/events/:id
 * Returns the full editable shape of an event for the admin edit form.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const rows = (await sql`
    SELECT
      a.id, a.title, a.description, a.start_at, a.end_at, a.timezone,
      a.venue_name, a.address, a.city, a.region,
      ST_X(a.location) AS lng, ST_Y(a.location) AS lat,
      a.age_min, a.age_max,
      a.cost_min_cents, a.cost_max_cents, a.currency,
      a.availability, a.is_virtual,
      a.organizer_name, a.organizer_url,
      a.url, a.image_url, a.categories,
      s.adapter_key AS source_adapter,
      s.name AS source_name
    FROM activities a
    LEFT JOIN sources s ON s.id = a.source_id
    WHERE a.id = ${id}
    LIMIT 1
  `) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    start_at: Date;
    end_at: Date | null;
    timezone: string | null;
    venue_name: string | null;
    address: string | null;
    city: string | null;
    region: string | null;
    lng: number | null;
    lat: number | null;
    age_min: number | null;
    age_max: number | null;
    cost_min_cents: number | null;
    cost_max_cents: number | null;
    currency: string | null;
    availability: string;
    is_virtual: boolean;
    organizer_name: string | null;
    organizer_url: string | null;
    url: string | null;
    image_url: string | null;
    categories: string[] | null;
    source_adapter: string | null;
    source_name: string | null;
  }>;

  const r = rows[0];
  if (!r) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({
    event: {
      id: r.id,
      title: r.title,
      description: r.description,
      startAt: r.start_at,
      endAt: r.end_at,
      timezone: r.timezone,
      venueName: r.venue_name,
      address: r.address,
      city: r.city,
      region: r.region,
      lng: r.lng,
      lat: r.lat,
      ageMin: r.age_min,
      ageMax: r.age_max,
      costMinCents: r.cost_min_cents,
      costMaxCents: r.cost_max_cents,
      currency: r.currency,
      availability: r.availability,
      isVirtual: r.is_virtual,
      organizerName: r.organizer_name,
      organizerUrl: r.organizer_url,
      url: r.url,
      imageUrl: r.image_url,
      categories: r.categories,
      sourceAdapter: r.source_adapter,
      sourceName: r.source_name,
    },
  });
}

interface PatchBody {
  title?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  venueName?: string;
  address?: string;
  city?: string;
  region?: string;
  lat?: string;
  lng?: string;
  ageMin?: string;
  ageMax?: string;
  costMin?: string;
  costMax?: string;
  currency?: string;
  availability?: string;
  organizerName?: string;
  organizerUrl?: string;
  url?: string;
  imageUrl?: string;
  categories?: string;
}

/**
 * PATCH /api/admin/events/:id
 * Update fields on an existing event. Note: re-ingestion of scraped sources
 * will overwrite changes. Manually-entered events are safe to edit because
 * their source has enabled=false.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  if (!body.startAt) return NextResponse.json({ error: 'startAt required' }, { status: 400 });
  const startAt = new Date(body.startAt);
  if (isNaN(startAt.getTime())) {
    return NextResponse.json({ error: 'invalid startAt' }, { status: 400 });
  }
  const endAt = body.endAt ? new Date(body.endAt) : null;
  if (endAt && isNaN(endAt.getTime())) {
    return NextResponse.json({ error: 'invalid endAt' }, { status: 400 });
  }

  for (const f of ['url', 'imageUrl', 'organizerUrl'] as const) {
    const v = body[f];
    if (v && v.trim() && !isSafeHttpUrl(v.trim())) {
      return NextResponse.json({ error: `invalid ${f}` }, { status: 400 });
    }
  }

  const dollarsToCents = (s: string | undefined): number | null => {
    if (!s || !s.trim()) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  };
  const intOrNull = (s: string | undefined): number | null => {
    if (!s || !s.trim()) return null;
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) return null;
    return n;
  };

  const lat = body.lat?.trim() ? Number(body.lat) : null;
  const lng = body.lng?.trim() ? Number(body.lng) : null;
  if (lat != null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
    return NextResponse.json({ error: 'invalid lat' }, { status: 400 });
  }
  if (lng != null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) {
    return NextResponse.json({ error: 'invalid lng' }, { status: 400 });
  }

  const categoryList = (body.categories ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const locationExpr =
    lat != null && lng != null
      ? sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`
      : sql`location`; // keep existing

  const availability =
    body.availability && /^(onsale|free|dropin|sold_out|cancelled|unknown)$/.test(body.availability)
      ? body.availability
      : 'onsale';

  const result = (await sql`
    UPDATE activities SET
      title = ${title},
      description = ${body.description?.trim() || null},
      start_at = ${startAt},
      end_at = ${endAt},
      timezone = ${body.timezone?.trim() || 'America/New_York'},
      venue_name = ${body.venueName?.trim() || null},
      address = ${body.address?.trim() || null},
      city = ${body.city?.trim() || null},
      region = ${body.region?.trim() || null},
      location = ${locationExpr},
      age_min = ${intOrNull(body.ageMin)},
      age_max = ${intOrNull(body.ageMax)},
      cost_min_cents = ${dollarsToCents(body.costMin)},
      cost_max_cents = ${dollarsToCents(body.costMax)},
      currency = ${body.currency?.trim() || 'USD'},
      availability = ${availability},
      organizer_name = ${body.organizerName?.trim() || null},
      organizer_url = ${body.organizerUrl?.trim() || null},
      url = ${body.url?.trim() || null},
      image_url = ${body.imageUrl?.trim() || null},
      categories = ${categoryList.length > 0 ? categoryList : null},
      updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `) as unknown as { id: string }[];

  if (result.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
