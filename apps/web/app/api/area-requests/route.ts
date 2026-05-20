import { NextResponse } from 'next/server';
import { db, areaRequests } from '@proactivity/db';
import { notifyAdminOfPending } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  email?: string;
  name?: string;
  regionText?: string;
  lat?: number;
  lng?: number;
  relationship?: string;
  committedEventCount?: number;
}

const ALLOWED_REL = new Set(['resident', 'organizer', 'attendee']);

/**
 * POST /api/area-requests
 * Public form submission for "bring Proactivity to my area". Stored in
 * area_requests and emailed to the admin queue (kind=area_request).
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const email = body.email?.trim() ?? '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }
  const regionText = body.regionText?.trim() ?? '';
  if (!regionText || regionText.length > 200) {
    return NextResponse.json({ error: 'region required (under 200 chars)' }, { status: 400 });
  }
  const name = body.name?.trim().slice(0, 120) || null;
  const relationship = body.relationship?.trim().toLowerCase();
  const rel = relationship && ALLOWED_REL.has(relationship) ? relationship : null;
  let committedEventCount: number | null = null;
  if (body.committedEventCount != null) {
    const n = Number(body.committedEventCount);
    if (Number.isInteger(n) && n >= 0 && n <= 1000) committedEventCount = n;
  }
  const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) && body.lat >= -90 && body.lat <= 90 ? body.lat : null;
  const lng = typeof body.lng === 'number' && Number.isFinite(body.lng) && body.lng >= -180 && body.lng <= 180 ? body.lng : null;
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null;

  const [row] = await db
    .insert(areaRequests)
    .values({
      email,
      name,
      regionText,
      lat,
      lng,
      relationship: rel,
      committedEventCount,
      ipAddress: ip,
      status: 'requested',
    })
    .returning({ id: areaRequests.id });

  const summary = `${regionText}${committedEventCount ? ` (committed: ${committedEventCount} events)` : ''}`;
  const detail = `Relationship: ${rel ?? 'unspecified'}\nCoords: ${lat != null ? `${lat}, ${lng}` : 'not provided'}\nCommitted events: ${committedEventCount ?? 'unspecified'}\nName: ${name ?? 'not given'}`;
  await notifyAdminOfPending({
    kind: 'area_request',
    summary,
    detail,
    submitterEmail: email,
  });

  return NextResponse.json({ ok: true, id: row!.id });
}
