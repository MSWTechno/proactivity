/**
 * One-off ingestion for the Trissels & Grace Mennonite Vacation Bible School
 * "Running for the Prize", nightly Sun Jun 7 – Thu Jun 11, 2026.
 * Source: flyer image saved to Downloads 2026-06-03.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-trissels-grace-vbs-2026.ts
 *
 * Idempotent: keys on (sourceId, sourceEventId).
 *
 * Single multi-day row (one VBS program you register for, not drop-in nights):
 * start Sun 6pm, end Thu 8pm. Categories vbs + camps (VBS is a camps
 * specialization — see apps/web/lib/categories.ts). Venue/URL verified via web
 * search (trisselsmc.org; 11246 Hisers Lane, Broadway). Coords are a
 * Broadway-area approximation — ~20 km from Harrisonburg, inside the radius.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Trissels & Grace Mennonite Churches';
const ORGANIZER_KEY = 'trissels-grace-vbs-2026-import';
const URL = 'https://trisselsmc.org';

const VENUE = {
  name: 'Trissels Mennonite Church',
  address: '11246 Hisers Lane',
  city: 'Broadway',
  region: 'VA',
  lat: 38.628,
  lng: -78.775,
};

const EDT = '-04:00';

const EVENT = {
  title: 'Vacation Bible School: Running for the Prize',
  // Nightly 6–8 PM, Sun Jun 7 through Thu Jun 11. Modeled as one multi-day row.
  startAt: `2026-06-07T18:00:00${EDT}`,
  endAt: `2026-06-11T20:00:00${EDT}`,
  description:
    'Trissels and Grace Mennonite Churches invite kids (rising K–8th grade) ' +
    'to a week of Vacation Bible School — “Running for the Prize,” focused on ' +
    'faith and the stories of the Apostle Paul (Philippians 3:14). Nightly ' +
    '6:00–8:00 PM, Sunday June 7 through Thursday June 11, held at Trissels ' +
    'Mennonite Church. Thursday evening features a family meal and program. ' +
    'High-school students can sign up as Bible School helpers, and a parallel ' +
    'Bible study is offered for the older audience. Free; register via ' +
    'Trissels Mennonite Church (trisselsmc.org).',
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sourceEventIdFor(title: string, startAt: string): string {
  const stamp = new Date(startAt).toISOString().slice(0, 16).replace(/[T:]/g, '');
  return `manual-${slug(title).slice(0, 80)}-${stamp}`;
}

async function main() {
  let manual = (await db.select().from(sources).where(eq(sources.adapterKey, 'manual')))[0];
  if (!manual) {
    [manual] = await db
      .insert(sources)
      .values({ adapterKey: 'manual', name: 'Manual entries', enabled: false, config: {} })
      .returning();
    console.log(`[trissels-vbs] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[trissels-vbs] reusing existing "Manual entries" source (${manual.id})`);
  }

  const sourceEventId = sourceEventIdFor(EVENT.title, EVENT.startAt);
  const result = await db
    .insert(activities)
    .values({
      sourceId: manual!.id,
      sourceEventId,
      title: EVENT.title,
      description: EVENT.description,
      startAt: new Date(EVENT.startAt),
      endAt: new Date(EVENT.endAt),
      timezone: 'America/New_York',
      venueName: VENUE.name,
      address: VENUE.address,
      city: VENUE.city,
      region: VENUE.region,
      country: 'US',
      location: [VENUE.lng, VENUE.lat] as [number, number],
      ageMin: 5,
      ageMax: 14,
      costMinCents: 0,
      costMaxCents: 0,
      currency: 'USD',
      availability: 'free',
      isVirtual: false,
      organizerName: ORGANIZER_NAME,
      organizerUrl: URL,
      organizerKey: ORGANIZER_KEY,
      url: URL,
      imageUrl: null,
      categories: ['vbs', 'camps'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-trissels-grace-vbs-2026',
        importedAt: new Date().toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[trissels-vbs] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[trissels-vbs] done — skipped=1 (already present)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[trissels-vbs] failed:', e);
  process.exit(1);
});
