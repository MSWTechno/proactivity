import { NextResponse } from 'next/server';
import { db, urlSubmissions } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

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
    .returning({ id: urlSubmissions.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
