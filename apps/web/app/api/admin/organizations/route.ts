import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/organizations
 *
 * Query params:
 *   status     - 'pending' | 'approved' | 'rejected' | 'all' (default: all)
 *   search     - text match against organizer_name / organizer_key / user email
 *   limit      - max rows (default 200, cap 500)
 *
 * Returns every organizer_claim with the claimant's user email + a count
 * of activities tied to that organizer_key. Powers /admin/organizations
 * which lets admin delete any claim (incl. approved ones) — the
 * moderation dashboard only ever shows pending.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const url = new URL(request.url);
  const status = (url.searchParams.get('status') ?? 'all').toLowerCase();
  const search = url.searchParams.get('search')?.trim() ?? '';
  const limit = Math.min(500, Math.max(1, Math.floor(Number(url.searchParams.get('limit') ?? 200))));

  const statusFilter = ['pending', 'approved', 'rejected'].includes(status)
    ? sql`AND c.status = ${status}`
    : sql``;
  const searchFilter = search
    ? sql`AND (
        c.organizer_name ILIKE ${'%' + search + '%'}
        OR c.organizer_key ILIKE ${'%' + search + '%'}
        OR u.email ILIKE ${'%' + search + '%'}
      )`
    : sql``;

  const rows = (await sql`
    SELECT
      c.id, c.organizer_key, c.organizer_name, c.status,
      c.note, c.moderator_note, c.created_at, c.resolved_at,
      u.email AS user_email, u.name AS user_name,
      COALESCE((
        SELECT COUNT(*)::int FROM activities a WHERE a.organizer_key = c.organizer_key
      ), 0) AS event_count
    FROM organizer_claims c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE TRUE
      ${statusFilter}
      ${searchFilter}
    ORDER BY
      CASE c.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      c.created_at DESC
    LIMIT ${limit}
  `) as unknown as Array<{
    id: string;
    organizer_key: string;
    organizer_name: string | null;
    status: string;
    note: string | null;
    moderator_note: string | null;
    created_at: Date;
    resolved_at: Date | null;
    user_email: string | null;
    user_name: string | null;
    event_count: number;
  }>;

  return NextResponse.json({
    organizations: rows.map((r) => ({
      id: r.id,
      organizerKey: r.organizer_key,
      organizerName: r.organizer_name,
      status: r.status,
      note: r.note,
      moderatorNote: r.moderator_note,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      userEmail: r.user_email,
      userName: r.user_name,
      eventCount: r.event_count,
    })),
  });
}
