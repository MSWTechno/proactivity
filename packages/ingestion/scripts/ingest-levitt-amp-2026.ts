/**
 * One-off ingestion for the Levitt AMP Hburg 2026 free concert series.
 * Source flyer (Downloads, Jun 2026) + amphburg.com / downtownharrisonburg.org.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-levitt-amp-2026.ts
 *
 * Idempotent: each row keys on (sourceId, sourceEventId) via
 * `activities_source_event_unique`, so re-running is a no-op.
 *
 * NOTE: 2026 start times were not yet published at ingest time. Using 6:30pm
 * (the 2025 series start) with an end-time estimate of 8:30pm; descriptions
 * flag the time as unconfirmed. Update when AMPHburg.com posts the schedule.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Harrisonburg Downtown Renaissance';
const ORGANIZER_URL = 'https://www.downtownharrisonburg.org/levitt-amp-music-series';
const SERIES_URL = 'https://amphburg.com';

const VENUE = {
  name: 'Turner Pavilion Lawn',
  address: '228 S Liberty St',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.4496,
  lng: -78.8689,
};

// EDT (Jul–Sep → UTC-04:00).
const EDT = '-04:00';
const START = '18:30'; // 6:30pm — 2025 time; 2026 unconfirmed.
const END = '20:30'; // ~2hr estimate.

interface Concert {
  date: string;
  act: string;
  genre: string;
}

const CONCERTS: Concert[] = [
  { date: '2026-07-02', act: 'Scott Miller & The Commonwealth', genre: 'Americana & Roots Rock' },
  { date: '2026-07-15', act: 'Sinkane', genre: 'Krautrock, Electronica & Funk' },
  { date: '2026-07-29', act: 'Blair Crimmins & The Hookers', genre: 'Ragtime Jazz' },
  { date: '2026-08-05', act: 'Jason Carter Band', genre: 'Bluegrass Fiddle' },
  { date: '2026-08-12', act: 'Fabiola Méndez', genre: 'Folk, Afro-Caribbean & Jazz' },
  { date: '2026-08-19', act: 'Joslyn & The Sweet Compression', genre: 'Soul & Funk' },
  { date: '2026-09-02', act: 'Gentleman Brawlers', genre: 'Afrofunk & Indie Dance' },
];

interface EventRow {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
}

const events: EventRow[] = CONCERTS.map((c): EventRow => ({
  title: `Levitt AMP Hburg: ${c.act}`,
  description:
    `Free family-friendly outdoor concert in the Levitt AMP Hburg 2026 series. ` +
    `${c.act} — ${c.genre}. Local opener precedes the headliner. Sensory-friendly ` +
    `area and haptic vests available. On the Turner Pavilion Lawn in Downtown ` +
    `Harrisonburg. Start time shown (6:30pm) is the 2025 time — confirm the 2026 ` +
    `time at AMPHburg.com.`,
  startAt: `${c.date}T${START}:00${EDT}`,
  endAt: `${c.date}T${END}:00${EDT}`,
}));

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
    console.log(`[levitt] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[levitt] reusing existing "Manual entries" source (${manual.id})`);
  }

  let inserted = 0;
  let skipped = 0;

  for (const e of events) {
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
        costMinCents: 0,
        costMaxCents: 0,
        currency: 'USD',
        availability: 'free',
        isVirtual: false,
        organizerName: ORGANIZER_NAME,
        organizerUrl: ORGANIZER_URL,
        organizerKey: 'levitt-amp-2026-import',
        url: SERIES_URL,
        imageUrl: null,
        categories: ['music', 'family', 'outdoor'],
        raw: {
          source: 'admin-manual',
          createdBy: 'script:ingest-levitt-amp-2026',
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

  console.log(`[levitt] done — inserted=${inserted}, skipped=${skipped}, total=${events.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[levitt] failed:', e);
  process.exit(1);
});
