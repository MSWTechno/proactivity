import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { isSafeHttpUrl } from '@/lib/url';
import { notifyAdminOfPending } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/contact
 * Public form submission. Two shapes:
 *
 *   General inquiry  (kind='general' from /contact):
 *     { kind: 'general', name?, email, organization?, message }
 *     → stored as 'replied' (skips moderation; email IS the workflow)
 *
 *   Event submission (kind omitted/anything else from "Submit your event"):
 *     { name?, email, organization?, message, eventUrl?, eventData?, wantsOrgClaim? }
 *     → stored as 'new' for admin review in /admin/moderate
 *     → if eventData is present, the structured fields prefill /admin/events/new
 *     → if wantsOrgClaim is true, "Add as event" also creates an organizer_claim
 *
 * Event submissions REQUIRE: title, startAt, eventUrl, venueName, address.
 * (These constraints only apply when eventData is present — older clients
 * sending free-text-only submissions still work and fall back to the
 * message field on the admin card.)
 */
export async function POST(request: Request) {
  let body: ContactBody;
  try {
    body = (await request.json()) as ContactBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const email = body.email?.trim() ?? '';
  const message = body.message?.trim() ?? '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'valid email is required' }, { status: 400 });
  }
  if (email.length > 200) {
    return NextResponse.json({ error: 'email too long' }, { status: 400 });
  }
  if (!message || message.length < 10) {
    return NextResponse.json({ error: 'message required (10+ chars)' }, { status: 400 });
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: 'message too long' }, { status: 400 });
  }

  let eventUrl: string | null = null;
  if (body.eventUrl?.trim()) {
    const trimmed = body.eventUrl.trim();
    if (!isSafeHttpUrl(trimmed)) {
      return NextResponse.json({ error: 'invalid eventUrl' }, { status: 400 });
    }
    eventUrl = new URL(trimmed).toString();
  }

  const isGeneral = body.kind === 'general';

  // Validate structured event_data if present. Required fields when present:
  // title, startAt, eventUrl (the public submit form mandates these so
  // admins don't have to chase missing data).
  let normalizedEventData: NormalizedEventData | null = null;
  if (!isGeneral && body.eventData && typeof body.eventData === 'object') {
    const ed = body.eventData;
    const title = ed.title?.trim() ?? '';
    const startAtRaw = ed.startAt?.trim() ?? '';
    const venueName = ed.venueName?.trim() ?? '';
    const address = ed.address?.trim() ?? '';

    if (!title) return NextResponse.json({ error: 'eventData.title required' }, { status: 400 });
    if (title.length > 200) return NextResponse.json({ error: 'eventData.title too long' }, { status: 400 });
    if (!startAtRaw) return NextResponse.json({ error: 'eventData.startAt required' }, { status: 400 });
    const startAt = new Date(startAtRaw);
    if (isNaN(startAt.getTime())) {
      return NextResponse.json({ error: 'invalid eventData.startAt' }, { status: 400 });
    }
    const endAtRaw = ed.endAt?.trim();
    let endAt: Date | null = null;
    if (endAtRaw) {
      endAt = new Date(endAtRaw);
      if (isNaN(endAt.getTime())) {
        return NextResponse.json({ error: 'invalid eventData.endAt' }, { status: 400 });
      }
    }
    if (!eventUrl) return NextResponse.json({ error: 'eventUrl required for event submissions' }, { status: 400 });
    if (!venueName) return NextResponse.json({ error: 'eventData.venueName required' }, { status: 400 });
    if (!address) return NextResponse.json({ error: 'eventData.address required' }, { status: 400 });

    // Validate optional URL field.
    if (ed.imageUrl?.trim() && !isSafeHttpUrl(ed.imageUrl.trim())) {
      return NextResponse.json({ error: 'invalid eventData.imageUrl' }, { status: 400 });
    }

    const num = (v: unknown): number | null => {
      if (v === undefined || v === null || v === '') return null;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    normalizedEventData = {
      title: title.slice(0, 200),
      description: ed.description?.trim().slice(0, 4000) || null,
      startAt: startAt.toISOString(),
      endAt: endAt ? endAt.toISOString() : null,
      venueName: venueName.slice(0, 200),
      address: address.slice(0, 300),
      city: ed.city?.trim().slice(0, 120) || null,
      region: ed.region?.trim().slice(0, 60) || null,
      imageUrl: ed.imageUrl?.trim() || null,
      costMin: num(ed.costMin),
      costMax: num(ed.costMax),
      ageMin: num(ed.ageMin),
      ageMax: num(ed.ageMax),
      categories: typeof ed.categories === 'string' ? ed.categories.trim().slice(0, 300) : null,
    };
  }

  const wantsOrgClaim = !isGeneral && body.wantsOrgClaim === true;

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null;

  const name = body.name?.trim().slice(0, 120) ?? null;
  const org = body.organization?.trim().slice(0, 200) ?? null;
  // General inquiries don't need admin moderation — the email IS the workflow.
  // Insert as 'replied' so they're preserved for audit but skip the queue.
  const status = isGeneral ? 'replied' : 'new';
  await sql`
    INSERT INTO contact_submissions (
      name, email, organization, message, event_url, ip_address, status,
      event_data, wants_org_claim
    ) VALUES (
      ${name},
      ${email},
      ${org},
      ${message},
      ${eventUrl},
      ${ip},
      ${status},
      ${normalizedEventData ? JSON.stringify(normalizedEventData) : null}::jsonb,
      ${wantsOrgClaim}
    )
  `;

  const summary = isGeneral
    ? (org ? `General inquiry from "${org}"` : 'General inquiry via contact form')
    : (normalizedEventData
        ? `Event submission: ${normalizedEventData.title}`
        : (org ? `Event submission from "${org}"` : 'Event submission via contact form'));
  // Awaited (not fire-and-forget): on Vercel serverless, pending promises
  // can be killed when the function suspends after the response. ~200ms
  // added to the response is fine for a contact form.
  await notifyAdminOfPending({
    kind: isGeneral ? 'contact_general' : 'contact',
    summary,
    detail: message,
    submitterEmail: email,
  });

  return NextResponse.json({ ok: true });
}

interface ContactBody {
  name?: string;
  email?: string;
  organization?: string;
  message?: string;
  eventUrl?: string;
  kind?: 'event' | 'general';
  eventData?: RawEventData;
  wantsOrgClaim?: boolean;
}

interface RawEventData {
  title?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  venueName?: string;
  address?: string;
  city?: string;
  region?: string;
  imageUrl?: string;
  costMin?: string | number;
  costMax?: string | number;
  ageMin?: string | number;
  ageMax?: string | number;
  categories?: string;
}

interface NormalizedEventData {
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  venueName: string;
  address: string;
  city: string | null;
  region: string | null;
  imageUrl: string | null;
  costMin: number | null;
  costMax: number | null;
  ageMin: number | null;
  ageMax: number | null;
  categories: string | null;
}
