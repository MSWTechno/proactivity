import { NextResponse } from 'next/server';
import { db, organizerClaims, sql } from '@proactivity/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { notifyAdminOfPending } from '@/lib/email';

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

  // Look up organizer_name + organizer_url from any activity row so we can
  // (a) snapshot the name on the claim and (b) attempt domain-match auto-
  // approval (if the claimant's email domain matches the organizer URL's
  // domain, they get approved on the spot — no admin review needed).
  const orgRow = (await sql`
    SELECT organizer_name, organizer_url
    FROM activities
    WHERE organizer_key = ${key} AND organizer_name IS NOT NULL
    LIMIT 1
  `) as unknown as { organizer_name: string | null; organizer_url: string | null }[];
  const organizerName = orgRow[0]?.organizer_name ?? null;
  const organizerUrl = orgRow[0]?.organizer_url ?? null;

  const autoApprove = shouldAutoApprove(user.email, organizerUrl);
  const status: 'pending' | 'approved' = autoApprove ? 'approved' : 'pending';

  try {
    const [row] = await db
      .insert(organizerClaims)
      .values({
        userId: user.id,
        organizerKey: key,
        organizerName,
        note,
        status,
        ...(autoApprove ? { resolvedAt: new Date() } : {}),
      })
      .returning({ id: organizerClaims.id });

    if (!autoApprove) {
      await notifyAdminOfPending({
        kind: 'claim',
        summary: `Claim for "${organizerName ?? key}"`,
        detail: note,
        submitterEmail: user.email,
      });
    }

    return NextResponse.json({ ok: true, id: row!.id, status, autoApproved: autoApprove });
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

// Free webmail + disposable / burner mail services — never treat as
// proof of ownership. user@gmail.com claiming acme.com doesn't prove
// they're at Acme, and user@mailinator.com claiming anything is spam.
const FREE_EMAIL_DOMAINS = new Set([
  // mainstream consumer webmail
  'gmail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'fastmail.com', 'mail.com', 'gmx.com', 'gmx.us',
  'zoho.com', 'yandex.com', 'tutanota.com', 'tuta.io',
  // disposable / temporary mail
  'mailinator.com', 'yopmail.com', 'guerrillamail.com', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'throwaway.email', 'dispostable.com',
  'sharklasers.com', 'getnada.com', 'trashmail.com', 'maildrop.cc',
  'spamgourmet.com', 'mintemail.com', 'fakeinbox.com',
]);

/**
 * Domain-match auto-approval: claim email's domain must equal the
 * organizer URL's registrable domain. Skipped for free-mail domains
 * since user@gmail.com isn't proof of owning anything. Best-effort —
 * uses last-two-labels as the registrable domain (good enough for
 * common .com/.org; doesn't handle .co.uk-style suffixes but the
 * false-negative case just falls through to admin review).
 */
function shouldAutoApprove(email: string, organizerUrl: string | null): boolean {
  if (!organizerUrl) return false;
  const emailDomain = email.split('@')[1]?.toLowerCase().trim();
  if (!emailDomain || FREE_EMAIL_DOMAINS.has(emailDomain)) return false;
  let urlDomain: string;
  try {
    urlDomain = new URL(organizerUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const base = (d: string) => d.split('.').slice(-2).join('.');
  return base(emailDomain) === base(urlDomain);
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

/**
 * DELETE /api/organizer/claim?id=<claimId>
 * Removes the current user's claim for an organization. If the org is a
 * user-created one (key starts with 'user:') AND no other approved claim
 * exists for it, all activities tied to that organizer_key are also hard-
 * deleted — there'd be no one left to manage them. For source-ingested
 * orgs that the user claimed, only the claim row goes; the activities
 * stay (they belong to the source, not the user).
 */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim() ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const claim = (
    await db
      .select()
      .from(organizerClaims)
      .where(and(eq(organizerClaims.id, id), eq(organizerClaims.userId, user.id)))
      .limit(1)
  )[0];
  if (!claim) {
    return NextResponse.json({ error: 'not your claim' }, { status: 403 });
  }

  const result = await db.transaction(async (tx) => {
    await tx.delete(organizerClaims).where(eq(organizerClaims.id, id));

    // Only cascade-delete activities for user-created orgs when no other
    // approved claim is left. Source-ingested orgs (eventbrite-foo, etc.)
    // never auto-prune.
    let deletedActivities = 0;
    if (claim.organizerKey.startsWith('user:')) {
      const remaining = await tx
        .select({ id: organizerClaims.id })
        .from(organizerClaims)
        .where(
          and(
            eq(organizerClaims.organizerKey, claim.organizerKey),
            eq(organizerClaims.status, 'approved'),
          ),
        )
        .limit(1);
      if (remaining.length === 0) {
        const deleted = (await sql`
          DELETE FROM activities WHERE organizer_key = ${claim.organizerKey} RETURNING id
        `) as unknown as { id: string }[];
        deletedActivities = deleted.length;
      }
    }
    return { deletedActivities };
  });

  return NextResponse.json({ ok: true, deletedActivities: result.deletedActivities });
}
