/**
 * One-off ingestion for the Weyers Cave Volunteer Fire Company Lawn Party,
 * nightly Wed Jun 3 – Sat Jun 6, 2026.
 * Source: the regional "lawn party season" calendar image (Downloads
 * 2026-06-02) + web search for venue/times.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-weyers-cave-lawn-party-2026.ts
 *
 * Idempotent. Single multi-day row (one lawn party that runs several nights):
 * start Jun 3 4pm, end Jun 6 10pm. Categories festivals/community/food.
 * Venue behind the firehouse (1235 Keezletown Rd, Weyers Cave, Augusta Co) —
 * ~18 km from Harrisonburg, INSIDE the 25 km radius. URL = the fire company's
 * Facebook page (no standalone site found; feed needs a non-empty url).
 *
 * DATE NOTE: the calendar image lists Jun 3–6 for 2026; an older Facebook post
 * showed Jun 8–11 (likely a prior year). Trusting the image — verify if unsure.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Weyers Cave Volunteer Fire Company';
const ORGANIZER_KEY = 'weyers-cave-lawn-party-2026-import';
const URL = 'https://www.facebook.com/WeyersCaveFire';

const VENUE = {
  name: 'Weyers Cave Volunteer Fire Company',
  address: '1235 Keezletown Rd',
  city: 'Weyers Cave',
  region: 'VA',
  lat: 38.29,
  lng: -78.905,
};

const EDT = '-04:00';

const EVENT = {
  title: 'Weyers Cave Volunteer Fire Company Lawn Party',
  startAt: `2026-06-03T16:00:00${EDT}`,
  endAt: `2026-06-06T22:00:00${EDT}`,
  description:
    'The Weyers Cave Volunteer Fire Company’s annual lawn party — a Shenandoah ' +
    'Valley summer tradition and fundraiser for the fire company. Food is served ' +
    'nightly from 4:00 PM (barbecue & fried chicken, hamburgers, hot dogs, ' +
    'fries), with Bingo around 6:30–7:00 PM, plus carnival rides, games, and ' +
    'live music. Free admission; held behind the fire company at 1235 ' +
    'Keezletown Road, Weyers Cave. Runs nightly Wednesday June 3 through ' +
    'Saturday June 6, 2026.',
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
    console.log(`[weyers-cave] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[weyers-cave] reusing existing "Manual entries" source (${manual.id})`);
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
      categories: ['festivals', 'community', 'food'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-weyers-cave-lawn-party-2026',
        importedAt: new Date().toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[weyers-cave] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[weyers-cave] done — skipped=1 (already present)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[weyers-cave] failed:', e);
  process.exit(1);
});
