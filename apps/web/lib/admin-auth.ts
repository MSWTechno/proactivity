// Admin session via HMAC-signed cookie. The session is minted *after* an
// external sign-in succeeds (currently Google OAuth — see
// /api/admin/auth/google/callback). Authorization is based on the user's
// verified email matching `ADMIN_EMAILS` (comma-separated env var).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'proactivity_admin';
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

function secret(): string | null {
  // Prefer SESSION_SECRET, fall back to ADMIN_PASSWORD for backwards-compat.
  const s = process.env.SESSION_SECRET ?? process.env.ADMIN_PASSWORD;
  return s && s.length >= 16 ? s : null;
}

/**
 * Mint a signed session token. Payload is just the email — anyone with a
 * valid token is "the admin". Email is bound to the signature so an
 * attacker can't change it without the secret.
 */
export function mintAdminToken(email: string): string | null {
  const sec = secret();
  if (!sec) return null;
  const expSec = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S;
  const payload = `${encodeURIComponent(email)}.${expSec}`;
  const sig = createHmac('sha256', sec).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token: string | undefined): { email: string } | null {
  if (!token) return null;
  const sec = secret();
  if (!sec) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [emailEnc, expStr, sig] = parts as [string, string, string];
  const expSec = Number(expStr);
  if (!Number.isFinite(expSec) || expSec < Math.floor(Date.now() / 1000)) return null;
  const payload = `${emailEnc}.${expStr}`;
  const expectedSig = createHmac('sha256', sec).update(payload).digest('hex');
  if (expectedSig.length !== sig.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(sig, 'hex'))) return null;
  } catch {
    return null;
  }
  return { email: decodeURIComponent(emailEnc) };
}

/**
 * Configured admin email allowlist. Comma-separated in `ADMIN_EMAILS`.
 * Lowercased on read for case-insensitive comparison.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.toLowerCase());
}

export async function adminSession(): Promise<{ email: string } | null> {
  const jar = await cookies();
  return verifyAdminToken(jar.get(COOKIE_NAME)?.value);
}

export async function isAdmin(): Promise<boolean> {
  return (await adminSession()) !== null;
}

export async function requireAdmin() {
  if (await isAdmin()) return null;
  return { status: 401, body: { error: 'unauthorized' } } as const;
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
export const ADMIN_COOKIE_MAX_AGE_S = SESSION_MAX_AGE_S;
