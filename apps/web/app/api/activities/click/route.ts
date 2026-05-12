import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/activities/click
 * Body: { "id": "<uuid>" }
 * Increments the behind-the-scenes click_count for that activity. Used
 * for tracking which events are most engaged with. No auth — public counter.
 */
export async function POST(request: Request) {
  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const result = (await sql`
    UPDATE activities SET click_count = click_count + 1 WHERE id = ${body.id} RETURNING id
  `) as unknown as { id: string }[];
  if (result.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
