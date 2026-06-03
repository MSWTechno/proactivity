/**
 * One-off ingestion for New Beginnings Church's "Into the Wild" NB Kids Camp,
 * Mon Jul 6 – Fri Jul 10, 2026.
 * Source: flyer image saved to Downloads 2026-06-03.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-nbc-into-the-wild-kids-camp-2026.ts
 *
 * Idempotent. Single multi-day row (one camp program), 9am–12pm daily.
 * Categories vbs + camps. Venue/URL verified via web search (nbcfamily.com;
 * 101 Pike Church Rd, Harrisonburg). Coords are a Harrisonburg approximation.
 * Starts Jul 6 (>30 days out today) — surfaces via the VBS filter (all-dates).
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'New Beginnings Church';
const ORGANIZER_KEY = 'new-beginnings-kids-camp-2026-import';
const URL = 'https://nbcfamily.com';

const VENUE = {
  name: 'New Beginnings Church',
  address: '101 Pike Church Rd',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.475,
  lng: -78.905,
};

const EDT = '-04:00';

const EVENT = {
  title: 'Into the Wild Kids Camp',
  startAt: `2026-07-06T09:00:00${EDT}`,
  endAt: `2026-07-10T12:00:00${EDT}`,
  description:
    'New Beginnings Church’s NB Kids Camp — “Into the Wild” (Seek. Follow. ' +
    'Trust.). A week of games, Bible lessons, and adventure for kids entering ' +
    'Kindergarten through 5th grade. 9:00 AM–12:00 PM, Monday July 6 through ' +
    'Friday July 10. Register at nbcfamily.com.',
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
    console.log(`[nbc-camp] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[nbc-camp] reusing existing "Manual entries" source (${manual.id})`);
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
      ageMax: 11,
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
        createdBy: 'script:ingest-nbc-into-the-wild-kids-camp-2026',
        importedAt: new Date().toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[nbc-camp] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[nbc-camp] done — skipped=1 (already present)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[nbc-camp] failed:', e);
  process.exit(1);
});
