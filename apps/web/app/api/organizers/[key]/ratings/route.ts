import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/organizers/:key/ratings
 * Returns approved ratings written against an organizer (target_kind='organizer').
 * Response shape mirrors /api/activities/:id/ratings so the UI can share a
 * single ReviewsModal component for both event and organizer reviews.
 *
 * `key` is the URL-encoded organizer_key (matches activities.organizer_key,
 * e.g. 'user:warren-world-nohz28' or an ingested 'ttm:org-12345' style key).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const organizerKey = decodeURIComponent(key).trim();
  if (!organizerKey || organizerKey.length > 200) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 });
  }

  const rows = (await sql`
    SELECT id, submitter_name, score, review, created_at
    FROM ratings
    WHERE target_kind = 'organizer'
      AND target_key = ${organizerKey}
      AND status = 'approved'
    ORDER BY created_at DESC
    LIMIT 100
  `) as unknown as Array<{
    id: string;
    submitter_name: string | null;
    score: number;
    review: string | null;
    created_at: Date;
  }>;

  const count = rows.length;
  const average = count > 0 ? rows.reduce((a, r) => a + r.score, 0) / count : null;

  return NextResponse.json({
    average: average != null ? Math.round(average * 10) / 10 : null,
    count,
    ratings: rows.map((r) => ({
      id: r.id,
      submitterName: r.submitter_name,
      score: r.score,
      review: r.review,
      createdAt: r.created_at,
    })),
  });
}
