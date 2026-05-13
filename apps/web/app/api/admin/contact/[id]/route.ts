import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/contact/:id
 * Body: { status: 'replied' | 'added' | 'rejected', note?: string }
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  let body: { status?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const valid = new Set(['replied', 'added', 'rejected']);
  if (!body.status || !valid.has(body.status)) {
    return NextResponse.json({ error: 'status must be replied|added|rejected' }, { status: 400 });
  }
  const note = body.note?.trim().slice(0, 500) ?? null;

  const result = (await sql`
    UPDATE contact_submissions
    SET status = ${body.status}, notes = ${note}, resolved_at = now()
    WHERE id = ${id}
    RETURNING id
  `) as unknown as { id: string }[];

  if (result.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
