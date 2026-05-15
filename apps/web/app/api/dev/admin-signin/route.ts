import { NextResponse } from 'next/server';
import {
  mintAdminToken,
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_MAX_AGE_S,
} from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/dev/admin-signin?email=...&next=/admin/moderate
 *
 * Dev-only bypass for the Google-OAuth admin sign-in. Mints an admin cookie
 * for any email (no ADMIN_EMAILS check — convenient for local moderation
 * testing). Returns 404 in production.
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
  const next = reqUrl.searchParams.get('next') ?? '/admin/moderate';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/admin/moderate';

  const token = mintAdminToken(email);
  if (!token) {
    return NextResponse.json({ error: 'SESSION_SECRET not configured' }, { status: 500 });
  }

  const dest = new URL(safeNext, reqUrl);
  const res = NextResponse.redirect(dest);
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_COOKIE_MAX_AGE_S,
  });
  return res;
}
