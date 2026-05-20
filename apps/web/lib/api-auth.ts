import { createHash, randomBytes } from 'node:crypto';
import { db, apiKeys, sql } from '@proactivity/db';
import { and, eq } from 'drizzle-orm';

/**
 * Public-API key auth + minting helpers.
 *
 * Keys are formatted as `pa_<32 hex chars>` so they're recognizable at a
 * glance ("pa" = proactivity api) and easy to grep in partner code /
 * support tickets. The plaintext key is never persisted — we store a
 * sha256 hash + the 8-char prefix (e.g. "pa_2a1f3c") so admins can
 * identify keys without exposing the secret.
 */

const KEY_PREFIX = 'pa_';

export function generateKey(): { plaintext: string; prefix: string; hash: string } {
  const random = randomBytes(16).toString('hex');
  const plaintext = `${KEY_PREFIX}${random}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 8),
    hash: hashKey(plaintext),
  };
}

export function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Extract bearer token from an Authorization header. Also accepts
 * `?key=` query param as a fallback for partners using tools that
 * can't easily set custom headers (e.g. some embed contexts).
 */
export function extractKey(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth) {
    const m = auth.match(/^Bearer\s+(\S+)/i);
    if (m) return m[1]!;
  }
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('key');
    if (q) return q;
  } catch { /* malformed url */ }
  return null;
}

export interface AuthResult {
  ok: true;
  id: string;
  label: string;
  dailyQuota: number | null;
}

export interface AuthError {
  ok: false;
  status: number;
  error: string;
}

/**
 * Look up the key, verify it's active, bump last_used_at. Returns the
 * key row on success. Quota enforcement (if dailyQuota is set) checks a
 * count of usage in the last 24h via a simple WHERE — for now we just
 * touch last_used_at without writing per-call audit rows; if you need
 * real per-call usage later, add a separate api_key_calls table.
 */
export async function authenticate(request: Request): Promise<AuthResult | AuthError> {
  const plaintext = extractKey(request);
  if (!plaintext) {
    return { ok: false, status: 401, error: 'missing API key (Authorization: Bearer <key> or ?key=)' };
  }
  const hash = hashKey(plaintext);
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.active, true)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { ok: false, status: 401, error: 'invalid or revoked API key' };
  }

  // Best-effort last-used update (non-blocking — failures are silent so
  // a transient DB blip on the update doesn't fail an otherwise-valid
  // request). On Vercel serverless we still await briefly to make the
  // bookkeeping reliable.
  try {
    await sql`UPDATE api_keys SET last_used_at = now() WHERE id = ${row.id}`;
  } catch { /* ignore */ }

  return {
    ok: true,
    id: row.id,
    label: row.label,
    dailyQuota: row.dailyQuota,
  };
}
