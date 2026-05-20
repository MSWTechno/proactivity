import { NextResponse } from 'next/server';
import { db, venueGeocodes, sql } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/venue-geocodes
 *
 * Lists rows from the geocode cache so the admin can audit what's
 * resolved, what failed, and intervene where it matters.
 *
 * Query params:
 *   status   - 'ok' | 'not_found' | 'error' | 'all' (default all)
 *   search   - substring match on normalized_address
 *   limit    - default 200, cap 1000
 *
 * Each row also carries `activityCount` — number of upcoming events
 * whose lower-cased address contains the geocode's address. Helps
 * prioritize which not_found rows are blocking the most events.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const url = new URL(request.url);
  const status = (url.searchParams.get('status') ?? 'all').toLowerCase();
  const search = url.searchParams.get('search')?.trim().toLowerCase() ?? '';
  const limit = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('limit') ?? 200))));

  const statusFilter = ['ok', 'not_found', 'error'].includes(status)
    ? sql`AND g.status = ${status}`
    : sql``;
  const searchFilter = search
    ? sql`AND g.normalized_address ILIKE ${'%' + search + '%'}`
    : sql``;

  const rows = (await sql`
    SELECT
      g.normalized_address, g.lat, g.lng, g.source, g.status,
      g.created_at, g.updated_at,
      COALESCE(c.cnt, 0)::int AS activity_count
    FROM venue_geocodes g
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
      FROM activities a
      WHERE a.start_at >= now()
        AND a.address IS NOT NULL
        AND LOWER(a.address) LIKE '%' || g.normalized_address || '%'
    ) c ON true
    WHERE TRUE
      ${statusFilter}
      ${searchFilter}
    ORDER BY
      CASE g.status WHEN 'error' THEN 0 WHEN 'not_found' THEN 1 ELSE 2 END,
      g.updated_at DESC
    LIMIT ${limit}
  `) as unknown as Array<{
    normalized_address: string;
    lat: number | null;
    lng: number | null;
    source: string;
    status: string;
    created_at: Date;
    updated_at: Date;
    activity_count: number;
  }>;

  // Summary counts across the whole table — for the dashboard header.
  const counts = (await sql`
    SELECT status, COUNT(*)::int AS n
    FROM venue_geocodes
    GROUP BY status
  `) as unknown as Array<{ status: string; n: number }>;
  const summary = { ok: 0, not_found: 0, error: 0, total: 0 };
  for (const c of counts) {
    if (c.status === 'ok' || c.status === 'not_found' || c.status === 'error') {
      summary[c.status] = c.n;
    }
    summary.total += c.n;
  }

  return NextResponse.json({
    summary,
    geocodes: rows.map((r) => ({
      normalizedAddress: r.normalized_address,
      lat: r.lat,
      lng: r.lng,
      source: r.source,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      activityCount: r.activity_count,
    })),
  });
}

interface UpsertBody {
  normalizedAddress?: string;
  lat?: number;
  lng?: number;
  /** When clearing — sets the row back to a state that retries on next ingest */
  clear?: boolean;
}

/**
 * POST /api/admin/venue-geocodes
 * Manual upsert. Two modes:
 *   - { normalizedAddress, lat, lng }       → set status='ok', source='manual'
 *   - { normalizedAddress, clear: true }    → delete the row (re-tries next ingest)
 *
 * Addresses are lower-cased + whitespace-collapsed before write, matching
 * the same normalization the geocode helper uses.
 */
export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  let body: UpsertBody;
  try {
    body = (await request.json()) as UpsertBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const addr = (body.normalizedAddress ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/^\s*[,;]+\s*|\s*[,;]+\s*$/g, '')
    .trim()
    .toLowerCase()
    .slice(0, 300);
  if (!addr) return NextResponse.json({ error: 'normalizedAddress required' }, { status: 400 });

  if (body.clear === true) {
    await db.delete(venueGeocodes).where(eq(venueGeocodes.normalizedAddress, addr));
    return NextResponse.json({ ok: true, cleared: true });
  }

  if (body.lat == null || body.lng == null) {
    return NextResponse.json({ error: 'lat and lng required (or set clear:true)' }, { status: 400 });
  }
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return NextResponse.json({ error: 'invalid lat' }, { status: 400 });
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'invalid lng' }, { status: 400 });
  }

  await sql`
    INSERT INTO venue_geocodes (normalized_address, lat, lng, source, status)
    VALUES (${addr}, ${lat}, ${lng}, 'manual', 'ok')
    ON CONFLICT (normalized_address) DO UPDATE SET
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      source = 'manual',
      status = 'ok',
      updated_at = NOW()
  `;
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/venue-geocodes?status=error
 * Bulk clear by status. Used for "retry all errors" after a Nominatim
 * outage or rate-limit episode. Without a status filter, refuses to
 * wipe the whole table (you'd lose 100+ resolved venues).
 */
export async function DELETE(request: Request) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const status = new URL(request.url).searchParams.get('status');
  if (!status || !['error', 'not_found'].includes(status)) {
    return NextResponse.json({ error: 'status query param must be error or not_found' }, { status: 400 });
  }
  const result = await db
    .delete(venueGeocodes)
    .where(eq(venueGeocodes.status, status))
    .returning({ normalizedAddress: venueGeocodes.normalizedAddress });
  return NextResponse.json({ ok: true, cleared: result.length });
}
