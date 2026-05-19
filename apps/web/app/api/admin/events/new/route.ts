import { NextResponse } from 'next/server';
import { db, activities, sources, contactSubmissions, users, organizerClaims, sql as pgSql } from '@proactivity/db';
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
 * Additionally, if that submission had wants_org_claim=true, the same
 * transaction find-or-creates a user by the submitter's email and queues
 * a 'pending' organizer_claim for them — the admin still has to approve
 * the claim separately in the claims queue, but the row is materialized
 * so the submitter doesn't have to re-do it.
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

  // If this came from a contact submission, look up wants_org_claim,
  // the submitter info (for queueing a claim), and any pre-existing
  // claimedOrganizerKey the submitter selected from their dropdown.
  const contactIdValue = body.contactId?.trim() || null;
  let claimContext: { email: string; name: string | null; org: string } | null = null;
  let preClaimedKey: string | null = null;
  if (contactIdValue) {
    const subRows = await db
      .select({
        email: contactSubmissions.email,
        name: contactSubmissions.name,
        organization: contactSubmissions.organization,
        wantsOrgClaim: contactSubmissions.wantsOrgClaim,
        eventData: contactSubmissions.eventData,
      })
      .from(contactSubmissions)
      .where(eq(contactSubmissions.id, contactIdValue))
      .limit(1);
    const sub = subRows[0];
    if (sub) {
      const ed = (sub.eventData ?? null) as null | { claimedOrganizerKey?: string };
      if (ed?.claimedOrganizerKey && typeof ed.claimedOrganizerKey === 'string') {
        preClaimedKey = ed.claimedOrganizerKey;
      }
      // Only queue a fresh claim when the submitter requested one AND
      // didn't pick an already-claimed org from their dropdown.
      if (sub.wantsOrgClaim && !preClaimedKey) {
        const claimOrg = sub.organization?.trim() || body.organizerName?.trim() || '';
        if (claimOrg) {
          claimContext = { email: sub.email, name: sub.name, org: claimOrg };
        }
      }
    }
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

  // Activity's organizer_key resolution:
  //   1. If the submitter picked an existing claimed org from their dropdown,
  //      use that key (preClaimedKey) — they're already an approved owner.
  //   2. Otherwise, if a fresh claim is being queued, reuse any existing
  //      key for this org name or mint a new user:<slug>-<suffix>.
  //   3. Otherwise null (legacy / no claim).
  const slugify = (s: string) =>
    s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let organizerKey: string | null = preClaimedKey;
  if (!organizerKey && claimContext) {
    const keyRows = (await pgSql`
      SELECT organizer_key FROM activities
      WHERE organizer_name = ${claimContext.org}
        AND organizer_key IS NOT NULL
      LIMIT 1
    `) as unknown as { organizer_key: string }[];
    organizerKey = keyRows[0]?.organizer_key
      ?? `user:${slugify(claimContext.org).slice(0, 60) || 'org'}-${Math.random().toString(36).slice(2, 8)}`;
  }

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
    organizerKey,
    url: eventUrl,
    imageUrl: body.imageUrl?.trim() || null,
    categories: categoryList.length > 0 ? categoryList : null,
    raw: {
      source: 'admin-manual',
      createdBy: 'admin',
      ...(contactIdValue ? { contactSubmissionId: contactIdValue } : {}),
    },
  };

  // Atomic: create the activity AND (if launched from a contact submission)
  // flip that submission to 'added'. If the submission requested an
  // organizer claim, also find-or-create the submitter as a user and
  // queue a pending organizer_claim. Either everything commits or nothing.
  let activityId: string;
  try {
    activityId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(activities)
        .values(activityValues)
        .onConflictDoNothing()
        .returning({ id: activities.id });
      if (inserted.length === 0) throw new Error('CONFLICT');

      if (contactIdValue) {
        await tx
          .update(contactSubmissions)
          .set({ status: 'added', resolvedAt: new Date() })
          .where(eq(contactSubmissions.id, contactIdValue));
      }

      if (claimContext && organizerKey) {
        // Find-or-create the user. Magic-link login uses the same users
        // table, so a future sign-in will pick up this row + the claim.
        const existingUser = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, claimContext.email))
          .limit(1);
        const userId = existingUser[0]?.id
          ?? (await tx
            .insert(users)
            .values({ email: claimContext.email, name: claimContext.name })
            .returning({ id: users.id }))[0]!.id;

        // Unique (user_id, organizer_key); if they already claimed this
        // org somehow, leave the prior claim untouched.
        await tx
          .insert(organizerClaims)
          .values({
            userId,
            organizerKey,
            organizerName: claimContext.org,
            note: `Auto-created from contact submission ${contactIdValue}`,
            status: 'pending',
          })
          .onConflictDoNothing();
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
