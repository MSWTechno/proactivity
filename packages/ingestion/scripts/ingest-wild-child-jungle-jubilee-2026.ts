/**
 * One-off ingestion for Wild Child: Museum & Menagerie's first-anniversary
 * festival — "1 Wild Year: A Jungle Jubilee" — Sun Jun 14, 2026.
 * Source: full event post text saved to Downloads 2026-06-03.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-wild-child-jungle-jubilee-2026.ts
 *
 * Idempotent: keys on (sourceId, sourceEventId).
 *
 * Organizer URL + venue verified via web search (wildchildmuseum.org; the
 * museum is inside the Shenandoah County Community Center, 6044 Main St,
 * Mount Jackson). Coords are town-level Mount Jackson — note this is ~38 km
 * from Harrisonburg, OUTSIDE the 25 km default radius, so it's feed-eligible
 * but only shows when a user widens their radius / picks a closer location.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Wild Child: Museum & Menagerie';
const ORGANIZER_KEY = 'wild-child-shenco-2026-import';
const URL = 'https://wildchildmuseum.org';

const VENUE = {
  name: 'Shenandoah County Community Center',
  address: '6044 Main St',
  city: 'Mount Jackson',
  region: 'VA',
  // Town-level Mount Jackson, VA 22842 (Main St); ~38 km N of Harrisonburg.
  lat: 38.7479,
  lng: -78.6428,
};

const EDT = '-04:00';

const EVENT = {
  title: '1 Wild Year: A Jungle Jubilee',
  startAt: `2026-06-14T12:00:00${EDT}`,
  endAt: `2026-06-14T16:00:00${EDT}`,
  description:
    'Wild Child: Museum & Menagerie celebrates its first anniversary with a ' +
    'family festival. FREE entry; activity tickets sold at the event ' +
    '($1 each, 25 for $20, 100 for $75) for games, crafts, pony rides, ' +
    'petting zoo, bounce house, museum entry, mini classes, and more.\n\n' +
    'Featured schedule: Mini Menagerie Petting Zoo (12–2), Summer Fun Previews ' +
    '(12 & 2, pre-registration), Open-Play in the Museum (12:30 & 2:30), ' +
    'Hogback Mountain Pony Rides (1–3), Close-Up Magic & Balloon Animals with ' +
    'Kevin Owens (2–4), Show Pig Spotlight (3–4), and the Jungle Jam Closing ' +
    'Ceremony & Raffle Drawing (3:30–4).\n\n' +
    'All day (12–4): “Jungle Jump” inflatable, carnival games, craft stations, ' +
    'face painting & fairy hair, “Lucky Leopard” raffles, and a Feeding Den ' +
    'with BBQ chicken, popcorn & treats. The first 50 families get a Wild ' +
    'Child welcome bag. Free entry covers magic shows, presentations, the ' +
    'closing ceremony, and indoor/outdoor play areas.',
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
    console.log(`[wildchild] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[wildchild] reusing existing "Manual entries" source (${manual.id})`);
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
      categories: ['family', 'festivals'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-wild-child-jungle-jubilee-2026',
        importedAt: new Date().toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[wildchild] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[wildchild] done — skipped=1 (already present)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[wildchild] failed:', e);
  process.exit(1);
});
