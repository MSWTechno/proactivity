import { NextResponse } from 'next/server';
import { db, organizerClaims, urlSubmissions } from '@proactivity/db';
import { and, desc, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { isSafeHttpUrl } from '@/lib/url';
import { notifyAdminOfPending } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/organizer/url-submissions
 * Body: { url, organizerKey?, note? }
 * User asks admin to scrape `url` for events. If organizerKey is provided
 * the user must have an approved claim for it; admin will route imported
 * activities to that organizer. Submissions land in a pending queue.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  let body: { url?: string; organizerKey?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const urlRaw = body.url?.trim();
  if (!urlRaw) return NextResponse.json({ error: 'url required' }, { status: 400 });
  if (urlRaw.length > 2000) {
    return NextResponse.json({ error: 'url too long' }, { status: 400 });
  }
  if (!isSafeHttpUrl(urlRaw)) {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  const organizerKey = body.organizerKey?.trim() || null;
  if (organizerKey) {
    const claim = (
      await db
        .select({ id: organizerClaims.id })
        .from(organizerClaims)
        .where(
          and(
            eq(organizerClaims.userId, user.id),
            eq(organizerClaims.organizerKey, organizerKey),
            eq(organizerClaims.status, 'approved'),
          ),
        )
        .limit(1)
    )[0];
    if (!claim) {
      return NextResponse.json(
        { error: 'You need an approved claim for that organizer.' },
        { status: 403 },
      );
    }
  }

  const note = body.note?.trim().slice(0, 1000) || null;

  const [row] = await db
    .insert(urlSubmissions)
    .values({ userId: user.id, organizerKey, url: urlRaw, note, status: 'pending' })
    .returning({ id: urlSubmissions.id });

  await notifyAdminOfPending({
    kind: 'url_submission',
    summary: organizerKey ? `URL for ${organizerKey}: ${urlRaw}` : `URL: ${urlRaw}`,
    detail: note,
    submitterEmail: user.email,
  });

  return NextResponse.json({ ok: true, id: row!.id });
}

/**
 * GET /api/organizer/url-submissions
 * Returns the current user's URL submissions (newest first).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ submissions: [] });

  const rows = await db
    .select()
    .from(urlSubmissions)
    .where(eq(urlSubmissions.userId, user.id))
    .orderBy(desc(urlSubmissions.createdAt))
    .limit(100);

  return NextResponse.json({
    submissions: rows.map((r) => ({
      id: r.id,
      url: r.url,
      organizerKey: r.organizerKey,
      note: r.note,
      status: r.status,
      moderatorNote: r.moderatorNote,
      importedCount: r.importedCount,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    })),
  });
}
