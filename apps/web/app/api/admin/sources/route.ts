import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { requireAdmin } from '@/lib/admin-auth';
import { LOCATION_PRESETS } from '@/lib/locations';

/**
 * Haversine between (lat1,lng1) and (lat2,lng2) in km. We could do this
 * in Postgres with ST_Distance for accuracy, but admin already has
 * lat/lng in the config jsonb and JS arithmetic is plenty for a "which
 * preset is closest" tag — saves us a per-row PostGIS call.
 */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestPresetId(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  let best: { id: string; km: number } | null = null;
  for (const p of LOCATION_PRESETS) {
    const km = distanceKm(lat, lng, p.lat, p.lng);
    if (!best || km < best.km) best = { id: p.id, km };
  }
  return best?.id ?? null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/sources
 *
 * Returns every source with health + volume signals so admin can spot
 * silent failures (last error, last run, days since last run, count
 * of events added in the last 24h, total upcoming, total lifetime).
 *
 * Single query — small enough that filtering is fine client-side.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const rows = (await sql`
    SELECT
      s.id, s.name, s.adapter_key, s.enabled,
      s.last_run_at, s.last_status, s.last_error,
      s.created_at, s.updated_at,
      -- All adapter configs that carry a hub coord put it at top-level
      -- as { lat, lng } (ical / rss / jsonld-event / ticketmaster /
      -- eventon all follow this convention). The organizer/manual
      -- adapters don't, and return null here.
      (s.config->>'lat')::float8 AS lat,
      (s.config->>'lng')::float8 AS lng,
      COALESCE(stats.total, 0)::int AS total_events,
      COALESCE(stats.upcoming, 0)::int AS upcoming_events,
      COALESCE(stats.added_24h, 0)::int AS added_24h,
      COALESCE(stats.added_7d, 0)::int AS added_7d
    FROM sources s
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)                                                 AS total,
        COUNT(*) FILTER (WHERE a.start_at >= now())              AS upcoming,
        COUNT(*) FILTER (WHERE a.created_at >= now() - interval '24 hours') AS added_24h,
        COUNT(*) FILTER (WHERE a.created_at >= now() - interval '7 days')   AS added_7d
      FROM activities a
      WHERE a.source_id = s.id
    ) stats ON true
    ORDER BY
      s.enabled DESC,
      CASE s.last_status WHEN 'error' THEN 0 WHEN 'ok' THEN 1 ELSE 2 END,
      s.name
  `) as unknown as Array<{
    id: string;
    name: string;
    adapter_key: string;
    enabled: boolean;
    last_run_at: Date | null;
    last_status: string | null;
    last_error: string | null;
    created_at: Date;
    updated_at: Date;
    total_events: number;
    upcoming_events: number;
    added_24h: number;
    added_7d: number;
    lat: number | null;
    lng: number | null;
  }>;

  return NextResponse.json({
    sources: rows.map((r) => ({
      id: r.id,
      name: r.name,
      adapterKey: r.adapter_key,
      enabled: r.enabled,
      lastRunAt: r.last_run_at,
      lastStatus: r.last_status,
      lastError: r.last_error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      totalEvents: r.total_events,
      upcomingEvents: r.upcoming_events,
      added24h: r.added_24h,
      added7d: r.added_7d,
      lat: r.lat,
      lng: r.lng,
      nearestPresetId: nearestPresetId(r.lat, r.lng),
    })),
  });
}
