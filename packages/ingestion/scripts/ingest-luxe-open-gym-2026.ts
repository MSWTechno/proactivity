/**
 * One-off ingestion for two Luxe Volleyball Academy (Luxe VA) drop-in events,
 * Jun 9–10, 2026 at Horizons Edge Sports Campus.
 * Source: two flyer images saved to Downloads 2026-06-02 (Facebook graphics).
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-luxe-open-gym-2026.ts
 *
 * Idempotent: keys on (sourceId, sourceEventId) via
 * `activities_source_event_unique`, so re-running is a no-op.
 *
 * Reuses the EXISTING organizer key `user:luxe-volleyball-academy-c0cd53` plus
 * the venue/coords already on Luxe's other rows, so these group under the same
 * organizer (ratings + organizer page aggregate correctly).
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Luxe Volleyball Academy';
const ORGANIZER_KEY = 'user:luxe-volleyball-academy-c0cd53';
const ORGANIZER_URL = 'https://luxevolleyball.com';
// Flyer lists www.luxevolleyball.com; use the org homepage (non-empty url
// required — the homepage feed drops null/empty url rows).
const URL = 'https://luxevolleyball.com';

const VENUE = {
  name: 'Horizons Edge Sports Campus',
  address: '325 Cornerstone Ln, Harrisonburg, VA 22802',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.4727265,
  lng: -78.818272,
};

// EDT (June → UTC-04:00).
const EDT = '-04:00';

interface EventRow {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  availability: 'free' | 'dropin';
  costCents: number;
}

const EVENTS: EventRow[] = [
  {
    title: 'Girls Open Gym',
    description:
      'Girls volleyball open gym hosted by Luxe Volleyball Academy (Luxe VA) ' +
      'at Horizons Edge Sports Campus. Drop in to play, 6:30–8:30 PM. Free. ' +
      'More info: info@luxevba.com or luxevolleyball.com.',
    startAt: `2026-06-10T18:30:00${EDT}`,
    endAt: `2026-06-10T20:30:00${EDT}`,
    availability: 'free',
    costCents: 0,
  },
  {
    title: 'Boys Open Play',
    description:
      'Boys volleyball open play hosted by Luxe Volleyball Academy (Luxe VA) ' +
      'at Horizons Edge Sports Campus. Drop in to play, 6:30–8:30 PM. ' +
      '$10 per player. More info: info@luxevba.com or luxevolleyball.com.',
    startAt: `2026-06-09T18:30:00${EDT}`,
    endAt: `2026-06-09T20:30:00${EDT}`,
    availability: 'dropin',
    costCents: 1000,
  },
];

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sourceEventIdFor(e: EventRow): string {
  const stamp = new Date(e.startAt).toISOString().slice(0, 16).replace(/[T:]/g, '');
  return `manual-${slug(e.title).slice(0, 80)}-${stamp}`;
}

async function main() {
  let manual = (await db.select().from(sources).where(eq(sources.adapterKey, 'manual')))[0];
  if (!manual) {
    [manual] = await db
      .insert(sources)
      .values({ adapterKey: 'manual', name: 'Manual entries', enabled: false, config: {} })
      .returning();
    console.log(`[luxe] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[luxe] reusing existing "Manual entries" source (${manual.id})`);
  }

  let inserted = 0;
  let skipped = 0;

  for (const e of EVENTS) {
    const sourceEventId = sourceEventIdFor(e);
    const result = await db
      .insert(activities)
      .values({
        sourceId: manual!.id,
        sourceEventId,
        title: e.title,
        description: e.description,
        startAt: new Date(e.startAt),
        endAt: new Date(e.endAt),
        timezone: 'America/New_York',
        venueName: VENUE.name,
        address: VENUE.address,
        city: VENUE.city,
        region: VENUE.region,
        country: 'US',
        location: [VENUE.lng, VENUE.lat] as [number, number],
        ageMin: null,
        ageMax: null,
        costMinCents: e.costCents,
        costMaxCents: e.costCents,
        currency: 'USD',
        availability: e.availability,
        isVirtual: false,
        organizerName: ORGANIZER_NAME,
        organizerUrl: ORGANIZER_URL,
        organizerKey: ORGANIZER_KEY,
        url: URL,
        imageUrl: null,
        categories: ['sports', 'volleyball'],
        raw: {
          source: 'admin-manual',
          createdBy: 'script:ingest-luxe-open-gym-2026',
          importedAt: new Date().toISOString(),
        },
      })
      .onConflictDoNothing()
      .returning({ id: activities.id });

    if (result.length > 0) {
      console.log(`  + ${e.startAt.slice(0, 16)}  ${e.title}  (${result[0]!.id})`);
      inserted++;
    } else {
      console.log(`  = ${e.startAt.slice(0, 16)}  ${e.title}  (already exists)`);
      skipped++;
    }
  }

  console.log(`[luxe] done — inserted=${inserted}, skipped=${skipped}, total=${EVENTS.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[luxe] failed:', e);
  process.exit(1);
});
