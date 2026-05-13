import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/events
 *
 * Query params:
 *   search     - text match against title (case-insensitive)
 *   organizer  - text match against organizer_name (case-insensitive)
 *   start      - lower bound ISO date (inclusive) on start_at
 *   end        - upper bound ISO date (inclusive) on start_at
 *   sort       - one of: clicks | start | title  (default: clicks desc)
 *   dir        - asc | desc (default desc for clicks, asc otherwise)
 *   limit      - max rows (default 100, cap 500)
 *   offset     - pagination offset
 */
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const url = new URL(request.url);
  const q = url.searchParams;
  const search = q.get('search')?.trim() ?? '';
  const organizer = q.get('organizer')?.trim() ?? '';
  const start = q.get('start')?.trim() ?? '';
  const end = q.get('end')?.trim() ?? '';
  const sortRaw = q.get('sort') ?? 'clicks';
  const dirRaw = q.get('dir') ?? (sortRaw === 'clicks' ? 'desc' : 'asc');
  const limit = Math.min(500, Math.max(1, Math.floor(Number(q.get('limit') ?? 100))));
  const offset = Math.max(0, Math.floor(Number(q.get('offset') ?? 0)));

  const validSorts: Record<string, string> = {
    clicks: 'click_count',
    start: 'start_at',
    title: 'title',
  };
  const sortCol = validSorts[sortRaw] ?? 'click_count';
  const dir = dirRaw === 'asc' ? sql`ASC` : sql`DESC`;

  const searchFilter = search ? sql`AND title ILIKE ${'%' + search + '%'}` : sql``;
  const organizerFilter = organizer ? sql`AND organizer_name ILIKE ${'%' + organizer + '%'}` : sql``;
  const startFilter = start ? sql`AND start_at >= ${new Date(start)}` : sql``;
  const endFilter = end ? sql`AND start_at <= ${new Date(end)}` : sql``;
  const orderClause = sortCol === 'click_count'
    ? sql`ORDER BY click_count ${dir}, start_at ASC`
    : sortCol === 'start_at'
      ? sql`ORDER BY start_at ${dir}`
      : sql`ORDER BY title ${dir}`;

  const rows = (await sql`
    SELECT
      id, title, start_at, organizer_name, organizer_url,
      city, region, url, click_count, availability, is_virtual
    FROM activities
    WHERE start_at >= now() - interval '90 days'
      ${searchFilter}
      ${organizerFilter}
      ${startFilter}
      ${endFilter}
    ${orderClause}
    LIMIT ${limit} OFFSET ${offset}
  `) as unknown as Array<{
    id: string;
    title: string;
    start_at: Date;
    organizer_name: string | null;
    organizer_url: string | null;
    city: string | null;
    region: string | null;
    url: string | null;
    click_count: number;
    availability: string;
    is_virtual: boolean;
  }>;

  const totalRow = (await sql`
    SELECT
      COUNT(*)::int AS total_events,
      COALESCE(SUM(click_count), 0)::int AS total_clicks
    FROM activities
    WHERE start_at >= now() - interval '90 days'
      ${searchFilter}
      ${organizerFilter}
      ${startFilter}
      ${endFilter}
  `) as unknown as [{ total_events: number; total_clicks: number }];

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      startAt: r.start_at,
      organizerName: r.organizer_name,
      organizerUrl: r.organizer_url,
      city: r.city,
      region: r.region,
      url: r.url,
      clickCount: r.click_count,
      availability: r.availability,
      isVirtual: r.is_virtual,
    })),
    totalEvents: totalRow[0]?.total_events ?? 0,
    totalClicks: totalRow[0]?.total_clicks ?? 0,
  });
}
