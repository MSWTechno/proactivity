import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { notifyAdminOfPending } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/ratings
 * Body: { activityId, score (1-5), review?, submitterName?, submitterEmail? }
 *
 * Looks up the activity to determine (source_id, target_key) for the
 * recurring series, then inserts a pending rating. Admin reviews via the
 * `pnpm ratings:list/approve/reject` CLI.
 */
export async function POST(request: Request) {
  let body: {
    activityId?: string;
    target?: 'event' | 'organizer';
    score?: number;
    review?: string;
    submitterName?: string;
    submitterEmail?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.activityId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.activityId)) {
    return NextResponse.json({ error: 'invalid activityId' }, { status: 400 });
  }
  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return NextResponse.json({ error: 'score must be integer 1-5' }, { status: 400 });
  }
  const review = (body.review ?? '').trim();
  if (review.length > 2000) {
    return NextResponse.json({ error: 'review too long' }, { status: 400 });
  }
  const target = body.target === 'organizer' ? 'organizer' : 'event';

  const lookup = (await sql`
    SELECT source_id, source_event_id, organizer_key
    FROM activities WHERE id = ${body.activityId} LIMIT 1
  `) as unknown as { source_id: string; source_event_id: string; organizer_key: string | null }[];
  if (lookup.length === 0) {
    return NextResponse.json({ error: 'activity not found' }, { status: 404 });
  }
  const { source_id, source_event_id, organizer_key } = lookup[0]!;

  let storedSourceId: string | null;
  let targetKey: string;
  if (target === 'organizer') {
    if (!organizer_key) {
      return NextResponse.json({ error: 'this event has no organizer to rate' }, { status: 400 });
    }
    // Organizer ratings are global — source_id stays null.
    storedSourceId = null;
    targetKey = organizer_key;
  } else {
    storedSourceId = source_id;
    // Recurring-base key: strip any "::<occurrence>" suffix.
    targetKey = source_event_id.split('::')[0]!;
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null;

  const submitterName = body.submitterName?.trim().slice(0, 80) ?? null;
  const submitterEmail = body.submitterEmail?.trim().slice(0, 200) ?? null;
  await sql`
    INSERT INTO ratings (
      source_id, target_kind, target_key,
      submitter_name, submitter_email, submitter_ip,
      score, review, status
    ) VALUES (
      ${storedSourceId}, ${target}, ${targetKey},
      ${submitterName}, ${submitterEmail}, ${ip},
      ${score}, ${review || null}, 'pending'
    )
  `;

  await notifyAdminOfPending({
    kind: 'rating',
    summary: `${'★'.repeat(score)} for ${target} ${targetKey}${submitterName ? ` from ${submitterName}` : ''}`,
    detail: review || null,
    submitterEmail,
  });

  return NextResponse.json({ ok: true, status: 'pending', target });
}
