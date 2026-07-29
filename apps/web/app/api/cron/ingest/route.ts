import { NextResponse } from 'next/server';
import { runAllSources } from '@proactivity/ingestion';

// Vercel cron handler. Triggered by the schedule in apps/web/vercel.json.
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically when
// CRON_SECRET is set as a project env var.
//
// Stay on the Node.js runtime — postgres-js + pg geography types don't run
// on Edge.
//
// maxDuration was 120s, tuned back when there were ~20 sources. The VA metro
// tiling took it to 65, and on 2026-07-29 the sweep hit FUNCTION_INVOCATION_
// TIMEOUT at exactly 120s (55 of 65 sources had run). 300s is Vercel's
// current default ceiling. Note this buys headroom, it does not make the
// sweep bounded — see the tiering note in runner.ts.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

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
