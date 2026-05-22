import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/activities/:id/go
 * Increments click_count and 302-redirects to the activity's external
 * URL. Used by the "Get tickets / official page" button on each event
 * detail page so click tracking works without requiring JS — search
 * engines and link previews that hit this URL count too.
 *
 * Falls back to redirecting home if the activity has no url or doesn't
 * exist; never throws to the user.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.redirect(new URL('/', _request.url), { status: 302 });
  }
  const rows = (await sql`
    UPDATE activities SET click_count = click_count + 1
    WHERE id = ${id}
    RETURNING url
  `) as unknown as { url: string | null }[];
  const url = rows[0]?.url;
  // Guard: some feeds (CivicEngage's iCal export, for one) populate URL
  // with a relative path. NextResponse.redirect on a relative path
  // resolves it against the request origin and lands users on our own
  // 404. Treat anything non-absolute as "no real link" and bounce to
  // the in-house detail page instead.
  const isAbsolute = url && /^https?:\/\//i.test(url);
  if (!isAbsolute) {
    return NextResponse.redirect(new URL(`/event/${id}`, _request.url), { status: 302 });
  }
  return NextResponse.redirect(url, { status: 302 });
}
