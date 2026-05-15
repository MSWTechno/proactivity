import { NextResponse } from 'next/server';
import {
  verifyMagicLinkToken,
  upsertUser,
  mintSessionToken,
  SESSION_COOKIE_MAX_AGE_S,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/auth/exchange
 * Body: { token: <magic-link token> }
 *
 * Mobile counterpart to GET /api/auth/verify. The mobile app intercepts the
 * proactivity:// deep link, pulls the magic-link token from the URL, and
 * POSTs it here. We mint a long-lived session token and return it as JSON
 * (NOT a cookie) — the mobile app stores it in AsyncStorage and sends it as
 * `Authorization: Bearer <token>` on subsequent API calls.
 */
export async function POST(request: Request) {
  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const verified = verifyMagicLinkToken(token);
  if (!verified) return NextResponse.json({ error: 'invalid or expired token' }, { status: 401 });

  let user;
  try {
    user = await upsertUser(verified.email);
  } catch {
    return NextResponse.json({ error: 'sign-in failed' }, { status: 500 });
  }

  const sessionToken = mintSessionToken(user.id);
  if (!sessionToken) {
    return NextResponse.json({ error: 'SESSION_SECRET not configured' }, { status: 500 });
  }

  return NextResponse.json({
    sessionToken,
    expiresInSec: SESSION_COOKIE_MAX_AGE_S,
    user: { id: user.id, email: user.email, name: user.name },
  });
}
