import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/activities/:id/ratings
 * Returns approved ratings for the activity's recurring-event series.
 * Response: { average: number | null, count: number, ratings: [...] }
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const lookup = (await sql`
    SELECT source_id, source_event_id FROM activities WHERE id = ${id} LIMIT 1
  `) as unknown as { source_id: string; source_event_id: string }[];
  if (lookup.length === 0) {
    return NextResponse.json({ error: 'activity not found' }, { status: 404 });
  }
  const { source_id, source_event_id } = lookup[0]!;
  const targetKey = source_event_id.split('::')[0]!;

  const rows = (await sql`
    SELECT id, submitter_name, score, review, created_at
    FROM ratings
    WHERE target_kind = 'event'
      AND source_id = ${source_id}
      AND target_key = ${targetKey}
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
