import { NextResponse } from 'next/server';
import { runAllSources } from '@proactivity/ingestion';

// Vercel cron handler. Triggered by the schedule in apps/web/vercel.json.
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically when
// CRON_SECRET is set as a project env var.
//
// Stay on the Node.js runtime — postgres-js + pg geography types don't run
// on Edge. maxDuration is 120s — current observed worst case (Visit
// Shenandoah at ~54s, total ~54s with concurrency=4) leaves ~2x headroom
// before this becomes a problem again. Vercel's per-plan ceiling is
// well above this so the value is honored on every plan today.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not set' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const startedAt = Date.now();
  try {
    await runAllSources();
    return NextResponse.json({ ok: true, ms: Date.now() - startedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message, ms: Date.now() - startedAt }, { status: 500 });
  }
  // Intentionally do NOT call sql.end(): on Vercel the function may stay warm
  // across invocations, and closing the pool would break subsequent runs.
}
