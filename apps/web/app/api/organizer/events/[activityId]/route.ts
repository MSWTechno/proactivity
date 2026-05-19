import { NextResponse } from 'next/server';
import { db, eventDrafts, sql } from '@proactivity/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { isSafeHttpUrl } from '@/lib/url';
import { notifyAdminOfPending } from '@/lib/email';

/**
 * A user can edit an activity if EITHER:
 *   - they have an approved organizer_claim for its organizer_key, OR
 *   - they were the submitter of the contact_submission this activity
 *     was created from (raw.contactSubmissionId match by email)
 *
 * Returns the reason ('owned' | 'submitted') so callers can decide
 * whether to expose org-only affordances. null = no access.
 */
async function checkEditAccess(
  userId: string,
  userEmail: string,
  activityId: string,
): Promise<'owned' | 'submitted' | null> {
  const rows = (await sql`
    SELECT
      a.organizer_key,
      EXISTS (
        SELECT 1 FROM organizer_claims c
        WHERE c.user_id = ${userId}
          AND c.organizer_key = a.organizer_key
          AND c.status = 'approved'
      ) AS owned,
      EXISTS (
        SELECT 1 FROM contact_submissions cs
        WHERE cs.id::text = a.raw->>'contactSubmissionId'
          AND cs.email = ${userEmail}
      ) AS submitted
    FROM activities a
    WHERE a.id = ${activityId}
    LIMIT 1
  `) as unknown as Array<{ organizer_key: string | null; owned: boolean; submitted: boolean }>;
  const r = rows[0];
  if (!r) return null;
  if (r.owned) return 'owned';
  if (r.submitted) return 'submitted';
  return null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PatchBody {
  title?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  venueName?: string;
  address?: string;
  city?: string;
  region?: string;
  lat?: number | string;
  lng?: number | string;
  ageMin?: number | string;
  ageMax?: number | string;
  costMin?: number | string;
  costMax?: number | string;
  currency?: string;
  availability?: string;
  organizerName?: string;
  organizerUrl?: string;
  url?: string;
  imageUrl?: string;
  categories?: string;
}

function toCents(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
function toInt(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}
function toFloat(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/organizer/events/:activityId
 * Returns the current full activity row plus any pending draft for it.
 * Used to prefill the org edit form.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ activityId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const { activityId } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activityId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const rows = (await sql`
    SELECT
      a.id, a.title, a.description, a.start_at, a.end_at, a.timezone,
      a.venue_name, a.address, a.city, a.region,
      ST_X(a.location) AS lng, ST_Y(a.location) AS lat,
      a.age_min, a.age_max,
      a.cost_min_cents, a.cost_max_cents, a.currency,
      a.availability, a.organizer_name, a.organizer_url, a.organizer_key,
      a.url, a.image_url, a.categories
    FROM activities a
    WHERE a.id = ${activityId}
    LIMIT 1
  `) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    start_at: Date;
    end_at: Date | null;
    timezone: string | null;
    venue_name: string | null;
    address: string | null;
    city: string | null;
    region: string | null;
    lng: number | null;
    lat: number | null;
    age_min: number | null;
    age_max: number | null;
    cost_min_cents: number | null;
    cost_max_cents: number | null;
    currency: string | null;
    availability: string;
    organizer_name: string | null;
    organizer_url: string | null;
    organizer_key: string | null;
    url: string | null;
    image_url: string | null;
    categories: string[] | null;
  }>;
  const r = rows[0];
  if (!r) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Either an approved claim for this org, or being the submitter, grants edit access.
  const access = await checkEditAccess(user.id, user.email, activityId);
  if (!access) {
    return NextResponse.json({ error: 'not your event' }, { status: 403 });
  }

  const pendingDraft = (
    await db
      .select()
      .from(eventDrafts)
      .where(
        and(
          eq(eventDrafts.userId, user.id),
          eq(eventDrafts.activityId, activityId),
          eq(eventDrafts.status, 'pending'),
        ),
      )
      .limit(1)
  )[0];

  return NextResponse.json({
    event: {
      id: r.id,
      title: r.title,
      description: r.description,
      startAt: r.start_at,
      endAt: r.end_at,
      timezone: r.timezone,
      venueName: r.venue_name,
      address: r.address,
      city: r.city,
      region: r.region,
      lng: r.lng,
      lat: r.lat,
      ageMin: r.age_min,
      ageMax: r.age_max,
      costMinCents: r.cost_min_cents,
      costMaxCents: r.cost_max_cents,
      currency: r.currency,
      availability: r.availability,
      organizerName: r.organizer_name,
      organizerUrl: r.organizer_url,
      organizerKey: r.organizer_key,
      url: r.url,
      imageUrl: r.image_url,
      categories: r.categories,
    },
    pendingDraft: pendingDraft
      ? {
          id: pendingDraft.id,
          createdAt: pendingDraft.createdAt,
        }
      : null,
  });
}

/**
 * PATCH /api/organizer/events/:activityId
 * Submits an EDIT draft for an existing event the user has an approved
 * claim for. The draft holds the proposed new values; the live activity
 * is untouched until admin approval.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ activityId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const { activityId } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activityId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const activity = (await sql`
    SELECT organizer_key FROM activities WHERE id = ${activityId} LIMIT 1
  `) as unknown as { organizer_key: string | null }[];
  const orgKey = activity[0]?.organizer_key;
  if (activity.length === 0) {
    return NextResponse.json({ error: 'event not found' }, { status: 404 });
  }

  const access = await checkEditAccess(user.id, user.email, activityId);
  if (!access) {
    return NextResponse.json({ error: 'not your event' }, { status: 403 });
  }

  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  if (!body.startAt) return NextResponse.json({ error: 'startAt required' }, { status: 400 });
  const startAt = new Date(body.startAt);
  if (isNaN(startAt.getTime())) {
    return NextResponse.json({ error: 'invalid startAt' }, { status: 400 });
  }
  const endAt = body.endAt ? new Date(body.endAt) : null;
  if (endAt && isNaN(endAt.getTime())) {
    return NextResponse.json({ error: 'invalid endAt' }, { status: 400 });
  }

  for (const f of ['url', 'imageUrl', 'organizerUrl'] as const) {
    const v = body[f];
    if (v && typeof v === 'string' && v.trim() && !isSafeHttpUrl(v.trim())) {
      return NextResponse.json({ error: `invalid ${f}` }, { status: 400 });
    }
  }

  // Cancel any pending draft for this same activity+user (avoid stacks).
  await db
    .update(eventDrafts)
    .set({ status: 'rejected', moderatorNote: 'superseded by newer submission', resolvedAt: new Date() })
    .where(
      and(
        eq(eventDrafts.userId, user.id),
        eq(eventDrafts.activityId, activityId),
        eq(eventDrafts.status, 'pending'),
      ),
    );

  const categoryList = (body.categories ?? '')
    .toString()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // event_drafts.organizer_key is NOT NULL. For submitter-only edits on
  // an activity with no real org, use a synthetic per-user placeholder.
  // It never matches a real claim and isn't propagated back to the
  // activity row on approval.
  const draftOrganizerKey = orgKey ?? `submitter:${user.id}`;

  const [row] = await db
    .insert(eventDrafts)
    .values({
      userId: user.id,
      organizerKey: draftOrganizerKey,
      activityId,
      title,
      description: body.description?.trim() || null,
      startAt,
      endAt,
      timezone: body.timezone?.trim() || null,
      venueName: body.venueName?.trim() || null,
      address: body.address?.trim() || null,
      city: body.city?.trim() || null,
      region: body.region?.trim() || null,
      lat: toFloat(body.lat),
      lng: toFloat(body.lng),
      ageMin: toInt(body.ageMin),
      ageMax: toInt(body.ageMax),
      costMinCents: toCents(body.costMin),
      costMaxCents: toCents(body.costMax),
      currency: body.currency?.trim() || null,
      availability: body.availability?.trim() || null,
      organizerName: body.organizerName?.trim() || null,
      organizerUrl: body.organizerUrl?.trim() || null,
      url: body.url?.trim() || null,
      imageUrl: body.imageUrl?.trim() || null,
      categories: categoryList.length > 0 ? categoryList : null,
      status: 'pending',
    })
    .returning({ id: eventDrafts.id });

  const orgLabel = body.organizerName?.trim() || orgKey || `submitter ${user.email}`;
  await notifyAdminOfPending({
    kind: 'event_draft',
    summary: `Edit to "${title}" by ${orgLabel}`,
    detail: body.description?.trim() ?? null,
    submitterEmail: user.email,
  });

  return NextResponse.json({ ok: true, id: row!.id });
}
