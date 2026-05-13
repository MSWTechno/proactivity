import { NextResponse } from 'next/server';
import {
  mintAdminToken,
  isAdminEmail,
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_MAX_AGE_S,
} from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const OAUTH_STATE_COOKIE = 'proactivity_oauth_state';

/**
 * GET /api/admin/auth/google/callback
 * Google redirects here after consent with ?code=... and ?state=...
 * We verify state, exchange the code for tokens, fetch the user's email,
 * check it's in ADMIN_EMAILS, and mint an admin session cookie.
 */
export async function GET(request: Request) {
  const reqUrl = new URL(request.url);
  const code = reqUrl.searchParams.get('code');
  const state = reqUrl.searchParams.get('state');
  const errorParam = reqUrl.searchParams.get('error');

  if (errorParam) {
    return redirectToLogin(reqUrl, `Google said no: ${errorParam}`);
  }
  if (!code || !state) {
    return redirectToLogin(reqUrl, 'missing code or state');
  }

  // Verify CSRF state — must match the cookie set in /api/admin/auth/google.
  const cookieHeader = request.headers.get('cookie') ?? '';
  const storedState = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(OAUTH_STATE_COOKIE.length + 1);
  if (!storedState || storedState !== state) {
    return redirectToLogin(reqUrl, 'state mismatch — try again');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectToLogin(reqUrl, 'OAuth credentials not configured');
  }

  const redirectUri = `${reqUrl.protocol}//${reqUrl.host}/api/admin/auth/google/callback`;

  // Exchange the auth code for tokens.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    return redirectToLogin(reqUrl, `token exchange failed (${tokenRes.status})`);
  }
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) {
    return redirectToLogin(reqUrl, 'no access token in response');
  }

  // Fetch user profile.
  const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    return redirectToLogin(reqUrl, `userinfo fetch failed (${userRes.status})`);
  }
  const user = (await userRes.json()) as { email?: string; email_verified?: boolean };
  if (!user.email || user.email_verified === false) {
    return redirectToLogin(reqUrl, 'no verified email returned');
  }
  if (!isAdminEmail(user.email)) {
    return redirectToLogin(reqUrl, `${user.email} is not an authorized admin`);
  }

  const token = mintAdminToken(user.email);
  if (!token) {
    return redirectToLogin(reqUrl, 'SESSION_SECRET not configured');
  }

  const dest = new URL('/admin/moderate', reqUrl);
  const res = NextResponse.redirect(dest);
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: ADMIN_COOKIE_MAX_AGE_S,
  });
  // Clear the oauth state cookie.
  res.cookies.set(OAUTH_STATE_COOKIE, '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
  });
  return res;
}

function redirectToLogin(reqUrl: URL, error: string): NextResponse {
  const dest = new URL('/admin/login', reqUrl);
  dest.searchParams.set('error', error);
  return NextResponse.redirect(dest);
}
