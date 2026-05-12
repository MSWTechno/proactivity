import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { ALL_CATEGORY_KEYS, type CategoryKey } from '@/lib/categories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/categories/click
 * Body: { "key": "music" }
 * Increments the aggregate click count for that category. Fire-and-forget
 * from the client. No auth — categories are public values; worst-case abuse
 * is bumping a chip up the list, which doesn't hurt anyone.
 */
export async function POST(request: Request) {
  let body: { key?: string };
  try {
    body = (await request.json()) as { key?: string };
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.key || !(ALL_CATEGORY_KEYS as readonly string[]).includes(body.key)) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 });
  }
  const key: CategoryKey = body.key as CategoryKey;
  await sql`
    INSERT INTO category_clicks (key, count, updated_at)
    VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE
    SET count = category_clicks.count + 1, updated_at = now()
  `;
  return NextResponse.json({ ok: true });
}
