/**
 * One-off ingestion for the Rotary + Rockingham County Parks & Recreation
 * "Celebration, Service & Community Impact" day on Sat Jun 6, 2026.
 * Source: flyer image saved to Downloads 2026-06-02 (Facebook event graphic).
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-rotary-community-impact-2026.ts
 *
 * Idempotent: keys on (sourceId, sourceEventId) via
 * `activities_source_event_unique`, so re-running is a no-op.
 *
 * Single event (food drive + coat drive + playground dedication). Venue coords
 * reused from ingest-rockingham-rec-open-gym-2026.ts (Penn Laird county rec;
 * exact "Park Way" address coords still unknown) — close enough for distance
 * sort. No canonical event URL on the flyer, so we point at the county
 * recreation Facebook page (required: the homepage feed drops null/empty url).
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Rotary Clubs & Rockingham County Parks & Recreation';
const ORGANIZER_KEY = 'rotary-community-impact-2026-import';
// Canonical page — required: the homepage feed (/api/activities) drops any
// activity with a null/empty url (they'd render as dead "#" links). The flyer
// has no event URL; the county rec page is the closest real, working link.
const URL = 'https://www.facebook.com/rockinghamcountyrecreation';

const VENUE = {
  name: 'Rockingham County Parks & Recreation Center',
  address: '1 Rockingham County Park Way',
  city: 'Penn Laird',
  region: 'VA',
  lat: 38.4153,
  lng: -78.7745,
};

// EDT (June → UTC-04:00).
const EDT = '-04:00';

const EVENT = {
  title: 'Celebration, Service & Community Impact',
  // Donation drop-off window 9:00–10:30 AM; Remarks & Dedication at 10:00 AM.
  startAt: `2026-06-06T09:00:00${EDT}`,
  endAt: `2026-06-06T10:30:00${EDT}`,
  description:
    'Local Rotary Clubs and Rockingham County Parks & Recreation celebrate ' +
    'their partnership with a morning of service. Donation drop-off runs ' +
    '9:00–10:30 AM at the Parks & Rec Center, with Remarks & a Dedication ' +
    'Ceremony at 10:00 AM at the playground.\n\n' +
    'FOOD DRIVE — more than just green beans and corn: canned fruit, carrots, ' +
    'potatoes, spinach, and peanut butter are all needed.\n' +
    'COAT DRIVE — coats for all ages and sizes; planning for winter starts now.\n\n' +
    'Beneficiary: Hope Distributed. Can’t attend but still want to help? ' +
    'Use Instacart to have donations delivered directly. Service Above Self.',
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
    console.log(`[rotary] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[rotary] reusing existing "Manual entries" source (${manual.id})`);
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
      ageMin: null,
      ageMax: null,
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
      categories: ['community', 'family'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-rotary-community-impact-2026',
        importedAt: new Date().toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[rotary] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[rotary] done — skipped=1 (already present)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[rotary] failed:', e);
  process.exit(1);
});
