import { NextResponse } from 'next/server';
import { db, activities, sources, contactSubmissions } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import { isSafeHttpUrl } from '@/lib/url';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/events/new
 * Manually create an event tied to the "Manual entries" source.
 *
 * Body shape mirrors form fields — dollars (not cents), ISO date strings,
 * comma-separated categories. `url` is required since we don't publish
 * events that users can't open.
 *
 * If `contactId` is provided, the activity insert and the contact
 * submission's status flip to 'added' happen in a single transaction.
 * This is how "Mark added" on the moderation queue actually produces an
 * activity instead of just hiding the submission.
 */
export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  let body: AddEventBody;
  try {
    body = (await request.json()) as AddEventBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: 'title too long' }, { status: 400 });

  if (!body.startAt) return NextResponse.json({ error: 'startAt required' }, { status: 400 });
  const startAt = new Date(body.startAt);
  if (isNaN(startAt.getTime())) {
    return NextResponse.json({ error: 'invalid startAt' }, { status: 400 });
  }
  const endAt = body.endAt ? new Date(body.endAt) : null;
  if (endAt && isNaN(endAt.getTime())) {
    return NextResponse.json({ error: 'invalid endAt' }, { status: 400 });
  }

  // url is required — we never publish an event without a link.
  const eventUrl = body.url?.trim();
  if (!eventUrl) return NextResponse.json({ error: 'url required' }, { status: 400 });
  if (!isSafeHttpUrl(eventUrl)) return NextResponse.json({ error: 'invalid url' }, { status: 400 });

  // Other URL fields stay optional but must be safe if present.
  for (const f of ['imageUrl', 'organizerUrl'] as const) {
    const v = body[f];
    if (v && v.trim() && !isSafeHttpUrl(v.trim())) {
      return NextResponse.json({ error: `invalid ${f}` }, { status: 400 });
    }
  }

  // contactId must be a valid uuid if provided.
  if (body.contactId !== undefined && body.contactId !== null && body.contactId !== '' && !UUID_RE.test(body.contactId)) {
    return NextResponse.json({ error: 'invalid contactId' }, { status: 400 });
  }

  // Find-or-create the "Manual entries" source.
  let manual = (await db.select().from(sources).where(eq(sources.adapterKey, 'manual')))[0];
  if (!manual) {
    [manual] = await db
      .insert(sources)
      .values({
        adapterKey: 'manual',
        name: 'Manual entries',
        enabled: false,
        config: {},
      })
      .returning();
  }

  // Generate a stable sourceEventId from the title + start, slugified.
  const slug = (s: string) =>
    s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const sourceEventId = `manual-${slug(title).slice(0, 80)}-${startAt.toISOString().slice(0, 16).replace(/[T:]/g, '')}`;

  const dollarsToCents = (s: string | undefined): number | null => {
    if (!s || !s.trim()) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  };

  const intOrNull = (s: string | undefined): number | null => {
    if (!s || !s.trim()) return null;
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) return null;
    return n;
  };

  const lat = body.lat?.trim() ? Number(body.lat) : 38.4496;
  const lng = body.lng?.trim() ? Number(body.lng) : -78.8689;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return NextResponse.json({ error: 'invalid lat' }, { status: 400 });
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'invalid lng' }, { status: 400 });
  }

  const categoryList = (body.categories ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const activityValues = {
    sourceId: manual!.id,
    sourceEventId,
    title,
    description: body.description?.trim() || null,
    startAt,
    endAt,
    timezone: body.timezone?.trim() || 'America/New_York',
    venueName: body.venueName?.trim() || null,
    address: body.address?.trim() || null,
    city: body.city?.trim() || null,
    region: body.region?.trim() || null,
    country: 'US',
    location: [lng, lat] as [number, number],
    ageMin: intOrNull(body.ageMin),
    ageMax: intOrNull(body.ageMax),
    costMinCents: dollarsToCents(body.costMin),
    costMaxCents: dollarsToCents(body.costMax),
    currency: body.currency?.trim() || 'USD',
    availability:
      body.availability && /^(onsale|free|dropin|sold_out|cancelled|unknown)$/.test(body.availability)
        ? body.availability
        : 'onsale',
    isVirtual: false,
    organizerName: body.organizerName?.trim() || null,
    organizerUrl: body.organizerUrl?.trim() || null,
    organizerKey: null,
    url: eventUrl,
    imageUrl: body.imageUrl?.trim() || null,
    categories: categoryList.length > 0 ? categoryList : null,
    raw: {
      source: 'admin-manual',
      createdBy: 'admin',
      ...(body.contactId ? { contactSubmissionId: body.contactId } : {}),
    },
  };

  // Atomic: create the activity AND (if launched from a contact submission)
  // flip that submission to 'added' in the same transaction. Either both
  // happen or neither — no more "I clicked added but no event was created".
  const contactId = body.contactId?.trim() || null;
  let activityId: string;
  try {
    activityId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(activities)
        .values(activityValues)
        .onConflictDoNothing()
        .returning({ id: activities.id });
      if (inserted.length === 0) throw new Error('CONFLICT');

      if (contactId) {
        await tx
          .update(contactSubmissions)
          .set({ status: 'added', resolvedAt: new Date() })
          .where(eq(contactSubmissions.id, contactId));
      }
      return inserted[0]!.id;
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'CONFLICT') {
      return NextResponse.json(
        { error: 'event with this title+start already exists' },
        { status: 409 },
      );
    }
    throw e;
  }
  return NextResponse.json({ ok: true, id: activityId });
}

interface AddEventBody {
  title?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  venueName?: string;
  address?: string;
  city?: string;
  region?: string;
  lat?: string;
  lng?: string;
  ageMin?: string;
  ageMax?: string;
  costMin?: string;
  costMax?: string;
  currency?: string;
  availability?: string;
  organizerName?: string;
  organizerUrl?: string;
  url?: string;
  imageUrl?: string;
  categories?: string;
  /** If set, resolve this contact submission as 'added' in the same txn. */
  contactId?: string;
}
