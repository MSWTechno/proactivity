import { NextResponse } from 'next/server';
import { db, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { runSource } from '@proactivity/ingestion';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Manual re-ingestion can take a while for big sources. Cap matches the
// cron route's plan ceiling (Hobby 60s, Pro 300s — Next.js will reject
// the bigger value on Hobby but the cap is harmless on either).
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/sources/:id
 * Body: { action: 'trigger' | 'enable' | 'disable' }
 *   - trigger : re-run ingestion for this source NOW. Synchronous —
 *               waits for the runner to finish (or the function to
 *               hit maxDuration). last_run_at / last_status / last_error
 *               are updated by the runner itself.
 *   - enable  : flip enabled=true (next cron run picks it up)
 *   - disable : flip enabled=false (cron skips it)
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

  const [source] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  if (!source) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (body.action === 'enable' || body.action === 'disable') {
    const enabled = body.action === 'enable';
    await db.update(sources).set({ enabled, updatedAt: new Date() }).where(eq(sources.id, id));
    return NextResponse.json({ ok: true, enabled });
  }

  if (body.action === 'trigger') {
    const startedAt = Date.now();
    try {
      await runSource(source.id, source.adapterKey, source.name, source.config);
      // runSource updates source.last_status / last_run_at / last_error
      // itself, so we just report timing.
      return NextResponse.json({ ok: true, ms: Date.now() - startedAt });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg, ms: Date.now() - startedAt }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'action must be trigger | enable | disable' }, { status: 400 });
}
