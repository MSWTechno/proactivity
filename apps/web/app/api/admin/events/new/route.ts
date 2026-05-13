import { NextResponse } from 'next/server';
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/events/new
 * Manually create an event tied to the "Manual entries" source.
 *
 * Body shape mirrors form fields — dollars (not cents), ISO date strings,
 * comma-separated categories.
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

  // Validate URL fields if provided.
  for (const f of ['url', 'imageUrl', 'organizerUrl'] as const) {
    const v = body[f];
    if (v && v.trim()) {
      try {
        new URL(v.trim());
      } catch {
        return NextResponse.json({ error: `invalid ${f}` }, { status: 400 });
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

  const result = await db
    .insert(activities)
    .values({
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
      url: body.url?.trim() || null,
      imageUrl: body.imageUrl?.trim() || null,
      categories: categoryList.length > 0 ? categoryList : null,
      raw: { source: 'admin-manual', createdBy: 'admin' },
    })
    .onConflictDoNothing()
    .returning({ id: activities.id });

  if (result.length === 0) {
    return NextResponse.json(
      { error: 'event with this title+start already exists' },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, id: result[0]!.id });
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
}
