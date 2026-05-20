import { NextResponse } from 'next/server';
import { db, apiKeys } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/api-keys/:id
 * Body: { action: 'revoke' | 'restore' }
 *
 * We flip the `active` flag rather than DELETE so the audit trail
 * (key prefix, label, last_used_at) survives. The plaintext key is
 * gone forever — restoring active=true makes the same key usable
 * again, so don't restore if the key was leaked.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const active = body.action === 'restore' ? true : body.action === 'revoke' ? false : null;
  if (active === null) {
    return NextResponse.json({ error: 'action must be revoke or restore' }, { status: 400 });
  }

  const updated = await db
    .update(apiKeys)
    .set({ active })
    .where(eq(apiKeys.id, id))
    .returning({ id: apiKeys.id, prefix: apiKeys.prefix, active: apiKeys.active });

  if (updated.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...updated[0] });
}

/**
 * DELETE /api/admin/api-keys/:id
 * Hard-delete a key row. Use this if you minted a test key and want
 * it out of the audit list entirely. For production keys, prefer
 * the revoke action (POST with action:'revoke') so the audit
 * history survives.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const deleted = await db.delete(apiKeys).where(eq(apiKeys.id, id)).returning({ id: apiKeys.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
