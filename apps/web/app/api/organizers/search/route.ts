import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/organizers/search?q=<text>
 *
 * Returns organizations that already have events in the system, matched
 * by name (case-insensitive substring). Used by the /organizer dashboard's
 * "Claim an existing organization" search so users don't have to know
 * the opaque organizer_key slug.
 *
 * Each row carries:
 *  - organizerKey + organizerName (from the activity)
 *  - upcoming event count (for sort + display)
 *  - your current claim status if you're signed in and have one
 *  - flag for whether someone else has an approved claim
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ organizers: [], hint: 'type at least 2 characters' });
  }
  if (q.length > 100) {
    return NextResponse.json({ error: 'query too long' }, { status: 400 });
  }

  const user = await getCurrentUser();
  const userId = user?.id ?? null;

  const rows = (await sql`
    WITH orgs AS (
      SELECT
        organizer_key,
        MAX(organizer_name) AS organizer_name,
        MAX(organizer_url)  AS organizer_url,
        COUNT(*) FILTER (WHERE start_at >= now())::int AS upcoming_count
      FROM activities
      WHERE organizer_key IS NOT NULL
        AND organizer_name IS NOT NULL
        AND organizer_name ILIKE ${'%' + q + '%'}
      GROUP BY organizer_key
    )
    SELECT
      o.organizer_key,
      o.organizer_name,
      o.organizer_url,
      o.upcoming_count,
      EXISTS (
        SELECT 1 FROM organizer_claims c
        WHERE c.organizer_key = o.organizer_key
          AND c.status = 'approved'
          ${userId ? sql`AND c.user_id <> ${userId}` : sql``}
      ) AS claimed_by_other,
      ${userId
        ? sql`(
            SELECT c.status FROM organizer_claims c
            WHERE c.organizer_key = o.organizer_key AND c.user_id = ${userId}
            LIMIT 1
          )`
        : sql`NULL::text`} AS your_status
    FROM orgs o
    ORDER BY o.upcoming_count DESC, o.organizer_name
    LIMIT 20
  `) as unknown as Array<{
    organizer_key: string;
    organizer_name: string;
    organizer_url: string | null;
    upcoming_count: number;
    claimed_by_other: boolean;
    your_status: 'pending' | 'approved' | 'rejected' | null;
  }>;

  return NextResponse.json({
    organizers: rows.map((r) => ({
      organizerKey: r.organizer_key,
      organizerName: r.organizer_name,
      organizerUrl: r.organizer_url,
      upcomingCount: r.upcoming_count,
      claimedByOther: r.claimed_by_other,
      yourStatus: r.your_status,
    })),
  });
}
