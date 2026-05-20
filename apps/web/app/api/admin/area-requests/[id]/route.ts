import { NextResponse } from 'next/server';
import { db, areaRequests } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/area-requests/:id
 * Body: { action: 'launch' | 'reject', note?: string }
 * Marks the request resolved. Launching doesn't auto-configure sources
 * yet — admin still does that out-of-band; this just bookmarks who to
 * email when the area is live.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: { action?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const status = body.action === 'launch' ? 'launched' : body.action === 'reject' ? 'rejected' : null;
  if (!status) return NextResponse.json({ error: 'action must be launch or reject' }, { status: 400 });
  const note = body.note?.trim().slice(0, 2000) ?? null;

  const updated = await db
    .update(areaRequests)
    .set({ status, moderatorNote: note, resolvedAt: new Date() })
    .where(eq(areaRequests.id, id))
    .returning({ id: areaRequests.id });

  if (updated.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/area-requests/:id
 * Hard-delete (for test rows). Use POST {action:'reject'} for real
 * rejections so audit history stays.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const deleted = await db.delete(areaRequests).where(eq(areaRequests.id, id)).returning({ id: areaRequests.id });
  if (deleted.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
