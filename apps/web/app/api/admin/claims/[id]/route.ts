import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/claims/:id
 * Body: { action: 'approve' | 'reject', note?: string }
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  let body: { action?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const status = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : null;
  if (!status) return NextResponse.json({ error: 'action must be approve|reject' }, { status: 400 });
  const note = body.note?.trim().slice(0, 500) ?? null;

  const result = (await sql`
    UPDATE organizer_claims
    SET status = ${status}, moderator_note = ${note}, resolved_at = now()
    WHERE id = ${id}
    RETURNING id
  `) as unknown as { id: string }[];
  if (result.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
