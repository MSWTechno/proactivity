import { NextResponse } from 'next/server';
import { db, apiKeys } from '@proactivity/db';
import { desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import { generateKey } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/api-keys
 * List all API keys (active and revoked). Plaintext keys are never
 * stored, so only the prefix + label + metadata is returned. The
 * plaintext is only ever surfaced ONCE, in the response to POST.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const rows = await db
    .select({
      id: apiKeys.id,
      prefix: apiKeys.prefix,
      label: apiKeys.label,
      ownerEmail: apiKeys.ownerEmail,
      dailyQuota: apiKeys.dailyQuota,
      active: apiKeys.active,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));

  return NextResponse.json({ keys: rows });
}

interface CreateBody {
  label?: string;
  ownerEmail?: string;
  /** null/omitted = unlimited */
  dailyQuota?: number | null;
}

/**
 * POST /api/admin/api-keys
 * Mint a new key. Body: { label, ownerEmail?, dailyQuota? }.
 * Response includes `plaintext` exactly ONCE; we don't store it.
 */
export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const label = body.label?.trim();
  if (!label) return NextResponse.json({ error: 'label required' }, { status: 400 });
  if (label.length > 100) return NextResponse.json({ error: 'label too long' }, { status: 400 });

  const ownerEmail = body.ownerEmail?.trim() || null;
  if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return NextResponse.json({ error: 'invalid ownerEmail' }, { status: 400 });
  }

  let dailyQuota: number | null = null;
  if (body.dailyQuota != null && body.dailyQuota !== '' as unknown as number) {
    const n = Number(body.dailyQuota);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
      return NextResponse.json({ error: 'dailyQuota must be 1..1000000 or null' }, { status: 400 });
    }
    dailyQuota = n;
  }

  const { plaintext, prefix, hash } = generateKey();

  const [row] = await db
    .insert(apiKeys)
    .values({
      keyHash: hash,
      prefix,
      label,
      ownerEmail,
      dailyQuota,
      active: true,
    })
    .returning({ id: apiKeys.id });

  return NextResponse.json({
    ok: true,
    id: row!.id,
    label,
    prefix,
    plaintext, // surfaced ONCE — never again, and never stored
  });
}
