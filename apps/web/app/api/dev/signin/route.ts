import { NextResponse } from 'next/server';
import {
  mintSessionToken,
  upsertUser,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_S,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/dev/signin?email=...&next=/
 *
 * Dev-only bypass for the magic-link flow. Upserts the user, sets a session
 * cookie, redirects. Short URL avoids the long-magic-link chat-client
 * wrapping issue when iterating in local dev. Returns 404 in production.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const reqUrl = new URL(request.url);
  const email = reqUrl.searchParams.get('email')?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 });
  }
  const next = reqUrl.searchParams.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const user = await upsertUser(email);
  const sessionToken = mintSessionToken(user.id);
  if (!sessionToken) {
    return NextResponse.json({ error: 'SESSION_SECRET not configured' }, { status: 500 });
  }

  const dest = new URL(safeNext, reqUrl);
  const res = NextResponse.redirect(dest);
  res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_S,
  });
  return res;
}
