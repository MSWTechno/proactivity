import { NextResponse } from 'next/server';
import { db, organizerClaims, sql } from '@proactivity/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/organizer/claim
 * Body: { organizerKey, note? }
 * Submits a claim. Admin must approve before the user can subscribe to
 * organizer_pro for that org.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  let body: { organizerKey?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const key = body.organizerKey?.trim();
  if (!key || key.length > 200) {
    return NextResponse.json({ error: 'organizerKey required' }, { status: 400 });
  }
  const note = body.note?.trim().slice(0, 1000) ?? null;

  // Look up organizer_name from any activity row for context.
  const nameRow = (await sql`
    SELECT organizer_name FROM activities WHERE organizer_key = ${key} LIMIT 1
  `) as unknown as { organizer_name: string | null }[];
  const organizerName = nameRow[0]?.organizer_name ?? null;

  try {
    const [row] = await db
      .insert(organizerClaims)
      .values({
        userId: user.id,
        organizerKey: key,
        organizerName,
        note,
        status: 'pending',
      })
      .returning({ id: organizerClaims.id });
    return NextResponse.json({ ok: true, id: row!.id });
  } catch (e) {
    // Unique violation on (user, organizer_key)
    if (e instanceof Error && /duplicate key|unique/.test(e.message)) {
      return NextResponse.json(
        { error: 'You already have a claim for this organizer.' },
        { status: 409 },
      );
    }
    throw e;
  }
}

/**
 * GET /api/organizer/claim
 * Returns the current user's claims with each org's event/click stats.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ claims: [] });

  const claims = await db
    .select()
    .from(organizerClaims)
    .where(eq(organizerClaims.userId, user.id));

  if (claims.length === 0) return NextResponse.json({ claims: [] });

  // Pull stats per organizer.
  const keys = claims.map((c) => c.organizerKey);
  const stats = (await sql`
    SELECT
      organizer_key,
      COUNT(*)::int AS event_count,
      COALESCE(SUM(click_count), 0)::int AS total_clicks,
      COALESCE(SUM(CASE WHEN start_at >= now() - interval '30 days' THEN click_count ELSE 0 END), 0)::int AS clicks_30d,
      COALESCE(SUM(CASE WHEN start_at >= now() THEN 1 ELSE 0 END), 0)::int AS upcoming_count
    FROM activities
    WHERE organizer_key = ANY(${keys})
    GROUP BY organizer_key
  `) as unknown as Array<{
    organizer_key: string;
    event_count: number;
    total_clicks: number;
    clicks_30d: number;
    upcoming_count: number;
  }>;
  const statsByKey = new Map(stats.map((s) => [s.organizer_key, s]));

  return NextResponse.json({
    claims: claims.map((c) => {
      const s = statsByKey.get(c.organizerKey);
      const { url: noteUrl, rest: noteRest } = parseNote(c.note);
      return {
        id: c.id,
        organizerKey: c.organizerKey,
        organizerName: c.organizerName,
        organizerUrl: noteUrl,
        userCreated: c.organizerKey.startsWith('user:'),
        status: c.status,
        note: noteRest,
        moderatorNote: c.moderatorNote,
        createdAt: c.createdAt,
        resolvedAt: c.resolvedAt,
        eventCount: s?.event_count ?? 0,
        upcomingCount: s?.upcoming_count ?? 0,
        totalClicks: s?.total_clicks ?? 0,
        clicks30d: s?.clicks_30d ?? 0,
      };
    }),
  });
}

/**
 * User-created orgs store the org URL inside `note` with a `[org-url] `
 * marker (avoids a schema column for this single optional field). Strip it
 * out so the dashboard can render it as a separate link.
 */
function parseNote(note: string | null): { url: string | null; rest: string | null } {
  if (!note) return { url: null, rest: null };
  const match = note.match(/^\[org-url\] (\S+)\s*(.*)$/s);
  if (!match) return { url: null, rest: note };
  return { url: match[1] ?? null, rest: match[2]?.trim() || null };
}
