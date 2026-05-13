// User authentication via magic links. HMAC-signed tokens for both the
// short-lived magic-link verification step and the long-lived session
// cookie. No tokens table — verification is stateless.
//
// Env vars:
//   SESSION_SECRET   shared HMAC secret (32+ chars). Also used by admin-auth.
//   RESEND_API_KEY   from https://resend.com (free tier 100/day)
//   MAGIC_LINK_FROM  email "From" address (must use a verified Resend domain
//                    for production; `onboarding@resend.dev` works for dev)
//   PUBLIC_BASE_URL  absolute URL where magic links should point. If unset,
//                    derived from the request.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db, users, type User } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { Resend } from 'resend';

const SESSION_COOKIE = 'proactivity_user';
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;     // 30 days
const MAGIC_LINK_MAX_AGE_S = 15 * 60;            // 15 minutes

function secret(): string | null {
  const s = process.env.SESSION_SECRET ?? process.env.ADMIN_PASSWORD;
  return s && s.length >= 16 ? s : null;
}

// ----- token mint/verify (used for both magic links and sessions) -----

function mintToken(payload: object, ttlSec: number, scope: string): string | null {
  const sec = secret();
  if (!sec) return null;
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  const sig = createHmac('sha256', `${sec}:${scope}`).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken<T extends object>(token: string | undefined, scope: string): T | null {
  if (!token) return null;
  const sec = secret();
  if (!sec) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', `${sec}:${scope}`).update(body).digest('base64url');
  if (expected.length !== sig.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected, 'base64url'), Buffer.from(sig, 'base64url'))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp?: number };
    if (!Number.isFinite(data.exp) || (data.exp as number) < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

// ----- magic links -----

export function mintMagicLinkToken(email: string): string | null {
  return mintToken({ email }, MAGIC_LINK_MAX_AGE_S, 'magic');
}

export function verifyMagicLinkToken(token: string): { email: string } | null {
  return verifyToken<{ email: string }>(token, 'magic');
}

export async function sendMagicLink(email: string, verifyUrl: string): Promise<void> {
  const from = process.env.MAGIC_LINK_FROM ?? 'onboarding@resend.dev';
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from,
    to: email,
    subject: 'Sign in to Proactivity',
    html: `
      <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h1 style="font-size: 22px; margin: 0 0 12px;">Sign in to Proactivity</h1>
        <p style="margin: 0 0 20px; color: #555;">Click the button below to sign in. This link expires in 15 minutes.</p>
        <p>
          <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #6d28d9; color: white; text-decoration: none; border-radius: 8px; font-weight: 500;">
            Sign me in
          </a>
        </p>
        <p style="margin: 24px 0 0; font-size: 13px; color: #888;">
          Or paste this URL into your browser:<br>
          <span style="word-break: break-all;">${verifyUrl}</span>
        </p>
        <p style="margin: 24px 0 0; font-size: 12px; color: #aaa;">
          If you didn't request this, you can ignore it.
        </p>
      </div>
    `,
    text: `Sign in to Proactivity:\n\n${verifyUrl}\n\nThis link expires in 15 minutes. If you didn't request this, you can ignore it.`,
  });
}

// ----- session cookie -----

export function mintSessionToken(userId: string): string | null {
  return mintToken({ uid: userId }, SESSION_MAX_AGE_S, 'session');
}

function verifySessionToken(token: string | undefined): { uid: string } | null {
  return verifyToken<{ uid: string }>(token, 'session');
}

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const session = verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const rows = await db.select().from(users).where(eq(users.id, session.uid)).limit(1);
  return rows[0] ?? null;
}

export async function upsertUser(email: string): Promise<User> {
  const lower = email.toLowerCase().trim();
  const result = await db
    .insert(users)
    .values({ email: lower, lastLoginAt: new Date() })
    .onConflictDoUpdate({
      target: users.email,
      set: { lastLoginAt: new Date() },
    })
    .returning();
  return result[0]!;
}

// Drizzle util — exported so the API route can update name if user sets one.
export async function updateUserName(userId: string, name: string): Promise<void> {
  await db.update(users).set({ name }).where(eq(users.id, userId));
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_COOKIE_MAX_AGE_S = SESSION_MAX_AGE_S;
