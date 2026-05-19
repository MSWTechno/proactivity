import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { requireAdmin } from '@/lib/admin-auth';
import { notifyClaimResolved } from '@/lib/email';

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
    UPDATE organizer_claims c
    SET status = ${status}, moderator_note = ${note}, resolved_at = now()
    FROM users u
    WHERE c.id = ${id} AND u.id = c.user_id
    RETURNING c.id, c.organizer_key, c.organizer_name, u.email AS user_email
  `) as unknown as { id: string; organizer_key: string; organizer_name: string | null; user_email: string }[];
  if (result.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Awaited (not fire-and-forget): on Vercel serverless, un-awaited promises
  // are cut off when the function returns and the email is silently dropped.
  // send() already swallows its own errors so this won't 500 the admin.
  const row = result[0]!;
  await notifyClaimResolved({
    to: row.user_email,
    organizerName: row.organizer_name ?? row.organizer_key,
    action: status,
    moderatorNote: note,
  });

  return NextResponse.json({ ok: true });
}
