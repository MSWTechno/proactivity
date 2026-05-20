import type { MetadataRoute } from 'next';
import { sql } from '@proactivity/db';

const SITE_BASE = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? 'https://proactivity.app';

/**
 * Next.js dynamic sitemap. Includes:
 *  - the homepage and a small set of evergreen routes
 *  - every upcoming activity (and any past activities still within 30
 *    days, so Google has time to deindex without us emitting 404s)
 *
 * Capped at 50k URLs (sitemap.xml standard limit). If we ever exceed
 * that, split into a sitemap index — but at current volume one file
 * is fine.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const evergreen: MetadataRoute.Sitemap = [
    { url: SITE_BASE + '/',             lastModified: now, changeFrequency: 'hourly',  priority: 1.0 },
    { url: SITE_BASE + '/about',        lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: SITE_BASE + '/contact',      lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: SITE_BASE + '/request-area', lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: SITE_BASE + '/pricing',      lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: SITE_BASE + '/privacy',      lastModified: now, changeFrequency: 'yearly',  priority: 0.2 },
  ];

  let eventEntries: MetadataRoute.Sitemap = [];
  try {
    const rows = (await sql`
      SELECT id, start_at, updated_at
      FROM activities
      WHERE url IS NOT NULL AND url <> ''
        AND start_at >= now() - interval '30 days'
      ORDER BY start_at DESC
      LIMIT 49000
    `) as unknown as Array<{ id: string; start_at: Date; updated_at: Date }>;
    eventEntries = rows.map((r) => ({
      url: `${SITE_BASE}/event/${r.id}`,
      lastModified: r.updated_at ?? r.start_at,
      // Upcoming events change as registration fills / details update;
      // past events are stable.
      changeFrequency: r.start_at >= now ? 'daily' : 'monthly',
      priority: r.start_at >= now ? 0.8 : 0.4,
    }));
  } catch {
    // Don't fail the whole sitemap if the DB hiccups — return evergreen
    // routes only. Google will retry.
  }

  return [...evergreen, ...eventEntries];
}
