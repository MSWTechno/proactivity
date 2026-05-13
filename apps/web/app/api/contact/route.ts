import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';

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
    try {
      eventUrl = new URL(body.eventUrl.trim()).toString();
    } catch {
      return NextResponse.json({ error: 'invalid eventUrl' }, { status: 400 });
    }
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null;

  await sql`
    INSERT INTO contact_submissions (
      name, email, organization, message, event_url, ip_address, status
    ) VALUES (
      ${body.name?.trim().slice(0, 120) ?? null},
      ${email},
      ${body.organization?.trim().slice(0, 200) ?? null},
      ${message},
      ${eventUrl},
      ${ip},
      'new'
    )
  `;

  return NextResponse.json({ ok: true });
}
