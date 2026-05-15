import { NextResponse } from 'next/server';
import { db, eventDrafts, organizerClaims, sql } from '@proactivity/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { isSafeHttpUrl } from '@/lib/url';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DraftBody {
  organizerKey?: string;
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
  // Recurrence (optional)
  recurrenceFreq?: string;            // 'weekly' | 'biweekly' | 'monthly'
  recurrenceCount?: number | string;  // 1..52
  recurrenceSkipDates?: string;       // comma- or newline-separated YYYY-MM-DD
}

function toCents(v: number | string | undefined): number | null {
  if (v === undefined || v === '' || v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
function toInt(v: number | string | undefined): number | null {
  if (v === undefined || v === '' || v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}
function toFloat(v: number | string | undefined): number | null {
  if (v === undefined || v === '' || v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * POST /api/organizer/events
 * Body: DraftBody with organizerKey + at least title + startAt.
 * Submits a NEW event draft. Requires an approved organizer_claim for the
 * given organizerKey belonging to the current user. Stored in event_drafts
 * with activityId=null; admin must approve before the event becomes public.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  let body: DraftBody;
  try {
    body = (await request.json()) as DraftBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const organizerKey = body.organizerKey?.trim();
  if (!organizerKey) return NextResponse.json({ error: 'organizerKey required' }, { status: 400 });

  // Require approved claim for this organizer.
  const claim = (
    await db
      .select()
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
      { error: 'You need an approved organizer claim for this organization.' },
      { status: 403 },
    );
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

  const lat = toFloat(body.lat);
  const lng = toFloat(body.lng);
  if (lat != null && (lat < -90 || lat > 90)) {
    return NextResponse.json({ error: 'invalid lat' }, { status: 400 });
  }
  if (lng != null && (lng < -180 || lng > 180)) {
    return NextResponse.json({ error: 'invalid lng' }, { status: 400 });
  }

  const categoryList = (body.categories ?? '')
    .toString()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Validate recurrence (optional). If recurrenceFreq is set, must be one
  // of the three supported frequencies and count must be 2..52.
  let recurrenceFreq: string | null = null;
  let recurrenceCount: number | null = null;
  let recurrenceSkipDates: string[] | null = null;
  if (body.recurrenceFreq && body.recurrenceFreq !== 'none') {
    if (!['weekly', 'biweekly', 'monthly'].includes(body.recurrenceFreq)) {
      return NextResponse.json({ error: 'invalid recurrenceFreq' }, { status: 400 });
    }
    recurrenceFreq = body.recurrenceFreq;
    const cnt = typeof body.recurrenceCount === 'number'
      ? body.recurrenceCount
      : Number(body.recurrenceCount);
    if (!Number.isInteger(cnt) || cnt < 2 || cnt > 52) {
      return NextResponse.json({ error: 'recurrenceCount must be 2..52' }, { status: 400 });
    }
    recurrenceCount = cnt;
    const skipRaw = (body.recurrenceSkipDates ?? '').toString();
    const skip = skipRaw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const d of skip) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return NextResponse.json({ error: `invalid skip date: ${d}` }, { status: 400 });
      }
    }
    recurrenceSkipDates = skip.length > 0 ? skip : null;
  }

  const [row] = await db
    .insert(eventDrafts)
    .values({
      userId: user.id,
      organizerKey,
      activityId: null,
      title,
      description: body.description?.trim() || null,
      startAt,
      endAt,
      timezone: body.timezone?.trim() || 'America/New_York',
      venueName: body.venueName?.trim() || null,
      address: body.address?.trim() || null,
      city: body.city?.trim() || null,
      region: body.region?.trim() || null,
      lat,
      lng,
      ageMin: toInt(body.ageMin),
      ageMax: toInt(body.ageMax),
      costMinCents: toCents(body.costMin),
      costMaxCents: toCents(body.costMax),
      currency: body.currency?.trim() || 'USD',
      availability: body.availability?.trim() || 'onsale',
      organizerName: body.organizerName?.trim() || claim.organizerName || null,
      organizerUrl: body.organizerUrl?.trim() || null,
      url: body.url?.trim() || null,
      imageUrl: body.imageUrl?.trim() || null,
      categories: categoryList.length > 0 ? categoryList : null,
      recurrenceFreq,
      recurrenceCount,
      recurrenceSkipDates,
      status: 'pending',
    })
    .returning({ id: eventDrafts.id });

  return NextResponse.json({ ok: true, id: row!.id });
}

/**
 * GET /api/organizer/events?organizerKey=...
 * Returns the current user's drafts (all statuses) for one or all of their
 * organizers, plus the live activities for context. Used by the dashboard.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ drafts: [], events: [] });

  const url = new URL(request.url);
  const filterKey = url.searchParams.get('organizerKey')?.trim() ?? '';

  // Fetch approved claims for this user (so we can scope organizer keys).
  const claims = await db
    .select()
    .from(organizerClaims)
    .where(and(eq(organizerClaims.userId, user.id), eq(organizerClaims.status, 'approved')));
  const userKeys = claims.map((c) => c.organizerKey);
  if (userKeys.length === 0) {
    return NextResponse.json({ drafts: [], events: [] });
  }

  const keysToQuery = filterKey
    ? userKeys.filter((k) => k === filterKey)
    : userKeys;
  if (keysToQuery.length === 0) {
    return NextResponse.json({ drafts: [], events: [] });
  }

  const drafts = await db
    .select()
    .from(eventDrafts)
    .where(eq(eventDrafts.userId, user.id));

  const events = (await sql`
    SELECT
      id, title, start_at, end_at, venue_name, city, region, url, image_url,
      cost_min_cents, cost_max_cents, availability, organizer_key,
      manual_override
    FROM activities
    WHERE organizer_key = ANY(${keysToQuery})
    ORDER BY start_at DESC
    LIMIT 200
  `) as unknown as Array<{
    id: string;
    title: string;
    start_at: Date;
    end_at: Date | null;
    venue_name: string | null;
    city: string | null;
    region: string | null;
    url: string | null;
    image_url: string | null;
    cost_min_cents: number | null;
    cost_max_cents: number | null;
    availability: string;
    organizer_key: string;
    manual_override: boolean;
  }>;

  return NextResponse.json({
    drafts: drafts
      .filter((d) => keysToQuery.includes(d.organizerKey))
      .map((d) => ({
        id: d.id,
        organizerKey: d.organizerKey,
        activityId: d.activityId,
        title: d.title,
        startAt: d.startAt,
        endAt: d.endAt,
        timezone: d.timezone,
        status: d.status,
        moderatorNote: d.moderatorNote,
        createdAt: d.createdAt,
        recurrenceFreq: d.recurrenceFreq,
        recurrenceCount: d.recurrenceCount,
        recurrenceSkipDates: d.recurrenceSkipDates,
      })),
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      startAt: e.start_at,
      endAt: e.end_at,
      venueName: e.venue_name,
      city: e.city,
      region: e.region,
      url: e.url,
      imageUrl: e.image_url,
      costMinCents: e.cost_min_cents,
      costMaxCents: e.cost_max_cents,
      availability: e.availability,
      organizerKey: e.organizer_key,
      manualOverride: e.manual_override,
    })),
  });
}
