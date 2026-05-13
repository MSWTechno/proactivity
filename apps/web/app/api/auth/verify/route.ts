import { NextResponse } from 'next/server';
import {
  verifyMagicLinkToken,
  mintSessionToken,
  upsertUser,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_S,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/auth/verify?token=...
 * User clicks the magic link in their email. We verify the token,
 * upsert the user record, mint a long-lived session cookie, and redirect
 * to the home page (or `next` query param if provided).
 */
export async function GET(request: Request) {
  const reqUrl = new URL(request.url);
  const token = reqUrl.searchParams.get('token');
  const next = reqUrl.searchParams.get('next') ?? '/';
  // Only allow same-site redirects.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!token) {
    return redirectToLogin(reqUrl, 'no token');
  }
  const verified = verifyMagicLinkToken(token);
  if (!verified) {
    return redirectToLogin(reqUrl, 'link is invalid or expired');
  }

  let user;
  try {
    user = await upsertUser(verified.email);
  } catch {
    return redirectToLogin(reqUrl, 'sign-in failed');
  }

  const sessionToken = mintSessionToken(user.id);
  if (!sessionToken) {
    return redirectToLogin(reqUrl, 'SESSION_SECRET not configured');
  }

  const dest = new URL(safeNext, reqUrl);
  const res = NextResponse.redirect(dest);
  // SameSite=Lax so the cookie is present on the redirect away from this
  // route (the magic link is typically clicked from an email client, which
  // is a cross-site context).
  res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_S,
  });
  return res;
}

function redirectToLogin(reqUrl: URL, error: string): NextResponse {
  const dest = new URL('/login', reqUrl);
  dest.searchParams.set('error', error);
  return NextResponse.redirect(dest);
}
