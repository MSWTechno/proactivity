import { NextResponse } from 'next/server';
import { mintMagicLinkToken, sendMagicLink } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/auth/login
 * Body: { email }
 * Mints a 15-minute magic-link token and emails it. Returns 200 even if
 * the email doesn't exist yet — the user will be created at verify-time.
 * Doesn't leak whether the email is already known.
 */
export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase() ?? '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'valid email is required' }, { status: 400 });
  }
  if (email.length > 200) {
    return NextResponse.json({ error: 'email too long' }, { status: 400 });
  }

  const token = mintMagicLinkToken(email);
  if (!token) {
    return NextResponse.json({ error: 'SESSION_SECRET not configured' }, { status: 500 });
  }

  const baseUrl =
    process.env.PUBLIC_BASE_URL ??
    `${new URL(request.url).protocol}//${new URL(request.url).host}`;
  const verifyUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
  const mobileVerifyUrl = `proactivity://auth/verify?token=${encodeURIComponent(token)}`;

  // Dev fallback: if no Resend key is configured and we're not in
  // production, print the verify URL to the server console so the dev
  // can click it without setting up email delivery.
  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== 'production') {
    console.log(`\n[dev magic link for ${email}]\n${verifyUrl}\nmobile: ${mobileVerifyUrl}\n`);
    return NextResponse.json({ ok: true, devVerifyUrl: verifyUrl, devMobileVerifyUrl: mobileVerifyUrl });
  }

  try {
    await sendMagicLink(email, verifyUrl, mobileVerifyUrl);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to send email' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
