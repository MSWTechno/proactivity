import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/organizer/organizations?search=
 * Returns distinct organizers from activities (organizer_key + name +
 * url + event count + total clicks). Used by the claim form to let users
 * pick the org they manage.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const search = q.get('search')?.trim() ?? '';

  const searchFilter = search
    ? sql`AND (organizer_name ILIKE ${'%' + search + '%'} OR organizer_url ILIKE ${'%' + search + '%'})`
    : sql``;

  const rows = (await sql`
    SELECT
      organizer_key,
      MAX(organizer_name)      AS organizer_name,
      MAX(organizer_url)       AS organizer_url,
      COUNT(*)::int            AS event_count,
      COALESCE(SUM(click_count), 0)::int AS total_clicks
    FROM activities
    WHERE organizer_key IS NOT NULL
      ${searchFilter}
    GROUP BY organizer_key
    ORDER BY event_count DESC, organizer_name ASC
    LIMIT 100
  `) as unknown as Array<{
    organizer_key: string;
    organizer_name: string | null;
    organizer_url: string | null;
    event_count: number;
    total_clicks: number;
  }>;

  return NextResponse.json({
    organizations: rows.map((r) => ({
      key: r.organizer_key,
      name: r.organizer_name,
      url: r.organizer_url,
      eventCount: r.event_count,
      totalClicks: r.total_clicks,
    })),
  });
}
