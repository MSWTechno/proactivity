import { NextResponse } from 'next/server';
import { db, areaRequests } from '@proactivity/db';
import { desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/area-requests
 * Returns every area request, ordered newest first. Clustering by geo is
 * left to the client so the admin can group by region_text or coords as
 * needed without us baking in a particular distance threshold.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const rows = await db
    .select()
    .from(areaRequests)
    .orderBy(desc(areaRequests.createdAt));

  return NextResponse.json({ requests: rows });
}
