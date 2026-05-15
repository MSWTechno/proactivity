import { NextResponse } from 'next/server';
import { db, organizerClaims } from '@proactivity/db';
import { and, eq, like, sql as ormSql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { isSafeHttpUrl } from '@/lib/url';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/organizer/create-org
 * Body: { name, url? }
 * Auto-approves a brand-new organization for the current user. Generates a
 * stable, namespaced organizer_key ("user:<slug>-<6-char random>") so it
 * can't collide with scraped-source organizer keys. The user can then
 * submit events for this org via the existing draft flow.
 *
 * Per-user limit: MAX_USER_ORGS user-created orgs to discourage spam.
 */
const MAX_USER_ORGS = 5;
const URL_MARKER = '[org-url] ';

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  let body: { name?: string; url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (name.length > 200) {
    return NextResponse.json({ error: 'name too long' }, { status: 400 });
  }

  const urlRaw = body.url?.trim() || null;
  if (urlRaw && !isSafeHttpUrl(urlRaw)) {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  // Per-user cap on user-created orgs.
  const existing = await db
    .select({ count: ormSql<number>`COUNT(*)::int` })
    .from(organizerClaims)
    .where(
      and(
        eq(organizerClaims.userId, user.id),
        like(organizerClaims.organizerKey, 'user:%'),
      ),
    );
  if ((existing[0]?.count ?? 0) >= MAX_USER_ORGS) {
    return NextResponse.json(
      { error: `You've reached the limit of ${MAX_USER_ORGS} user-created organizations.` },
      { status: 429 },
    );
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'org';
  // 6-char base36 suffix from random bytes — collision-resistant for the
  // small population of user-created orgs.
  const suffix = Math.random().toString(36).slice(2, 8);
  const organizerKey = `user:${slug}-${suffix}`;
  const claimNote = urlRaw ? `${URL_MARKER}${urlRaw}` : null;

  const [row] = await db
    .insert(organizerClaims)
    .values({
      userId: user.id,
      organizerKey,
      organizerName: name,
      note: claimNote,
      status: 'approved',
      resolvedAt: new Date(),
    })
    .returning({ id: organizerClaims.id });

  return NextResponse.json({
    ok: true,
    id: row!.id,
    organizerKey,
    organizerName: name,
    organizerUrl: urlRaw,
  });
}
