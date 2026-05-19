import { NextResponse } from 'next/server';
import { db, sql, organizerClaims } from '@proactivity/db';
import { and, eq } from 'drizzle-orm';
import { isSafeHttpUrl } from '@/lib/url';
import { notifyAdminOfPending } from '@/lib/email';
import { extractOgImage } from '@/lib/og-image';
import { getCurrentUser } from '@/lib/auth';

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

  let wantsOrgClaim = !isGeneral && body.wantsOrgClaim === true;

  // If the submitter is signed in and picked one of their approved orgs
  // from the dropdown, validate they really own the claim and stash the
  // key in event_data so "Add as event" can use it as the new activity's
  // organizer_key (no claim queue required). Silently ignore the field
  // on auth or ownership failure — never block the submission.
  let claimedOrganizerKey: string | null = null;
  if (!isGeneral && body.claimedOrganizerKey && typeof body.claimedOrganizerKey === 'string') {
    const requestedKey = body.claimedOrganizerKey.trim();
    if (requestedKey && requestedKey.length <= 200) {
      const user = await getCurrentUser();
      if (user) {
        const ownsClaim = await db
          .select({ id: organizerClaims.id })
          .from(organizerClaims)
          .where(
            and(
              eq(organizerClaims.userId, user.id),
              eq(organizerClaims.organizerKey, requestedKey),
              eq(organizerClaims.status, 'approved'),
            ),
          )
          .limit(1);
        if (ownsClaim.length > 0) {
          claimedOrganizerKey = requestedKey;
          // They already own the claim — don't queue a duplicate.
          wantsOrgClaim = false;
        }
      }
    }
  }

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

    // If the submitter didn't paste an image URL, try to extract one from
    // the event page itself (og:image / twitter:image). Best-effort: a
    // network/parse failure just leaves imageUrl null and the admin can
    // override it later. Bounded at ~5s so a slow page doesn't stall the
    // form response.
    let imageUrl: string | null = ed.imageUrl?.trim() || null;
    if (!imageUrl && eventUrl) {
      imageUrl = await extractOgImage(eventUrl);
    }

    normalizedEventData = {
      title: title.slice(0, 200),
      description: ed.description?.trim().slice(0, 4000) || null,
      startAt: startAt.toISOString(),
      endAt: endAt ? endAt.toISOString() : null,
      venueName: venueName.slice(0, 200),
      address: address.slice(0, 300),
      city: ed.city?.trim().slice(0, 120) || null,
      region: ed.region?.trim().slice(0, 60) || null,
      imageUrl,
      costMin: num(ed.costMin),
      costMax: num(ed.costMax),
      ageMin: num(ed.ageMin),
      ageMax: num(ed.ageMax),
      categories: typeof ed.categories === 'string' ? ed.categories.trim().slice(0, 300) : null,
      claimedOrganizerKey,
    };
  }

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
  /** Only honored when the signed-in user owns an approved claim for this key. */
  claimedOrganizerKey?: string;
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
  claimedOrganizerKey: string | null;
}
