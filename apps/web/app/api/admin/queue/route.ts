import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/queue
 * Returns both pending ratings and new contact submissions for the
 * moderation dashboard.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  // Ratings — most recent pending first, with associated activity title +
  // organizer name (for context) joined via target_key.
  const ratingRows = (await sql`
    SELECT
      r.id, r.target_kind, r.target_key, r.score, r.review, r.created_at,
      r.submitter_name, r.submitter_email,
      a.title AS activity_title, a.url AS activity_url,
      a.organizer_name, a.organizer_url
    FROM ratings r
    LEFT JOIN LATERAL (
      SELECT title, url, organizer_name, organizer_url
      FROM activities
      WHERE
        (r.target_kind = 'event'
          AND source_id = r.source_id
          AND SPLIT_PART(source_event_id, '::', 1) = r.target_key)
        OR (r.target_kind = 'organizer' AND organizer_key = r.target_key)
      ORDER BY start_at DESC
      LIMIT 1
    ) a ON true
    WHERE r.status = 'pending'
    ORDER BY r.created_at DESC
    LIMIT 200
  `) as unknown as Array<{
    id: string;
    target_kind: string;
    target_key: string;
    score: number;
    review: string | null;
    created_at: Date;
    submitter_name: string | null;
    submitter_email: string | null;
    activity_title: string | null;
    activity_url: string | null;
    organizer_name: string | null;
    organizer_url: string | null;
  }>;

  const contactRows = (await sql`
    SELECT id, name, email, organization, message, event_url,
           event_data, wants_org_claim, created_at
    FROM contact_submissions
    WHERE status = 'new'
    ORDER BY created_at DESC
    LIMIT 200
  `) as unknown as Array<{
    id: string;
    name: string | null;
    email: string;
    organization: string | null;
    message: string;
    event_url: string | null;
    event_data: Record<string, unknown> | null;
    wants_org_claim: boolean;
    created_at: Date;
  }>;

  const claimRows = (await sql`
    SELECT
      c.id, c.organizer_key, c.organizer_name, c.note, c.created_at,
      u.email AS user_email, u.name AS user_name,
      COALESCE((
        SELECT COUNT(*)::int FROM activities a WHERE a.organizer_key = c.organizer_key
      ), 0) AS event_count
    FROM organizer_claims c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.status = 'pending'
    ORDER BY c.created_at DESC
    LIMIT 200
  `) as unknown as Array<{
    id: string;
    organizer_key: string;
    organizer_name: string | null;
    note: string | null;
    user_email: string | null;
    user_name: string | null;
    event_count: number;
    created_at: Date;
  }>;

  return NextResponse.json({
    ratings: ratingRows.map((r) => ({
      id: r.id,
      targetKind: r.target_kind,
      targetKey: r.target_key,
      score: r.score,
      review: r.review,
      submitterName: r.submitter_name,
      submitterEmail: r.submitter_email,
      createdAt: r.created_at,
      activityTitle: r.activity_title,
      activityUrl: r.activity_url,
      organizerName: r.organizer_name,
      organizerUrl: r.organizer_url,
    })),
    submissions: contactRows.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      organization: s.organization,
      message: s.message,
      eventUrl: s.event_url,
      eventData: s.event_data,
      wantsOrgClaim: s.wants_org_claim,
      createdAt: s.created_at,
    })),
    claims: claimRows.map((c) => ({
      id: c.id,
      organizerKey: c.organizer_key,
      organizerName: c.organizer_name,
      note: c.note,
      userEmail: c.user_email,
      userName: c.user_name,
      eventCount: c.event_count,
      createdAt: c.created_at,
    })),
  });
}
