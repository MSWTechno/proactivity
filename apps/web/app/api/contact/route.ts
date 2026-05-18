import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { isSafeHttpUrl } from '@/lib/url';
import { notifyAdminOfPending } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/contact
 * Public form submission from event organizers asking to be added.
 * Body: { name?, email, organization?, message, eventUrl? }
 * Stored as 'new' for admin review (`pnpm contact:list/resolve`).
 */
export async function POST(request: Request) {
  let body: {
    name?: string;
    email?: string;
    organization?: string;
    message?: string;
    eventUrl?: string;
    kind?: 'event' | 'general';
  };
  try {
    body = await request.json();
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

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null;

  const name = body.name?.trim().slice(0, 120) ?? null;
  const org = body.organization?.trim().slice(0, 200) ?? null;
  await sql`
    INSERT INTO contact_submissions (
      name, email, organization, message, event_url, ip_address, status
    ) VALUES (
      ${name},
      ${email},
      ${org},
      ${message},
      ${eventUrl},
      ${ip},
      'new'
    )
  `;

  const isGeneral = body.kind === 'general';
  const summary = isGeneral
    ? (org ? `General inquiry from "${org}"` : 'General inquiry via contact form')
    : (org ? `Event submission from "${org}"` : 'Event submission via contact form');
  void notifyAdminOfPending({
    kind: 'contact',
    summary,
    detail: message,
    submitterEmail: email,
  });

  return NextResponse.json({ ok: true });
}
