import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/url-submissions
 * Lists pending URL-scrape requests with the submitter info attached so
 * the admin can route imported activities and contact the user if needed.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const rows = (await sql`
    SELECT
      s.id, s.url, s.organizer_key, s.note, s.status, s.imported_count,
      s.moderator_note, s.created_at, s.resolved_at,
      u.email AS submitter_email, u.name AS submitter_name
    FROM url_submissions s
    JOIN users u ON u.id = s.user_id
    WHERE s.status = 'pending'
    ORDER BY s.created_at ASC
    LIMIT 200
  `) as unknown as Array<{
    id: string;
    url: string;
    organizer_key: string | null;
    note: string | null;
    status: string;
    imported_count: number | null;
    moderator_note: string | null;
    created_at: Date;
    resolved_at: Date | null;
    submitter_email: string | null;
    submitter_name: string | null;
  }>;

  return NextResponse.json({
    submissions: rows.map((r) => ({
      id: r.id,
      url: r.url,
      organizerKey: r.organizer_key,
      note: r.note,
      status: r.status,
      importedCount: r.imported_count,
      moderatorNote: r.moderator_note,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      submitter: { email: r.submitter_email, name: r.submitter_name },
    })),
  });
}
