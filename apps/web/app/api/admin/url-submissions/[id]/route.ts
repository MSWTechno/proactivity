import { NextResponse } from 'next/server';
import { db, urlSubmissions, users } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import { notifyUrlSubmissionResolved } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ActionBody {
  action: 'imported' | 'rejected' | 'failed';
  note?: string;
  importedCount?: number;
}

/**
 * POST /api/admin/url-submissions/:id
 * Body: { action: 'imported'|'rejected'|'failed', note?, importedCount? }
 * Marks a URL submission resolved. Doesn't actually run any scraping —
 * admin handles the ingestion out-of-band (CLI / manual source addition)
 * and records the result here.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const { id } = await ctx.params;
  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!['imported', 'rejected', 'failed'].includes(body.action)) {
    return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  }

  const note = body.note?.trim().slice(0, 2000) ?? null;
  const importedCount = body.action === 'imported' && typeof body.importedCount === 'number' && body.importedCount >= 0
    ? Math.floor(body.importedCount)
    : null;

  const result = await db
    .update(urlSubmissions)
    .set({
      status: body.action,
      moderatorNote: note,
      importedCount,
      resolvedAt: new Date(),
    })
    .where(eq(urlSubmissions.id, id))
    .returning({ id: urlSubmissions.id, url: urlSubmissions.url, userId: urlSubmissions.userId });

  if (result.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Awaited (not fire-and-forget): on Vercel serverless, un-awaited promises
  // are cut off when the function returns and the email is silently dropped.
  const sub = result[0]!;
  const userRow = (await db.select({ email: users.email }).from(users).where(eq(users.id, sub.userId)).limit(1))[0];
  if (userRow?.email) {
    await notifyUrlSubmissionResolved({
      to: userRow.email,
      url: sub.url,
      action: body.action,
      importedCount,
      moderatorNote: note,
    });
  }

  return NextResponse.json({ ok: true });
}
