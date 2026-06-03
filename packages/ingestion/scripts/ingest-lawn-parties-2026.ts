/**
 * Batch ingestion for the 2026 Shenandoah Valley "lawn party season" — the
 * volunteer fire dept / Ruritan club fundraiser lawn parties (+ the two county
 * fairs and the Bergton car show) from the calendar image (Downloads
 * 2026-06-02). Weyers Cave is ingested separately
 * (ingest-weyers-cave-lawn-party-2026.ts). Stuarts Draft is intentionally
 * omitted — the image only said "Mid-August" and sources disagree.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-lawn-parties-2026.ts
 *
 * Idempotent (onConflictDoNothing on sourceId+sourceEventId).
 *
 * APPROXIMATIONS (verify before relying on them):
 *  - Dates are from the calendar image (corroborated by the rocktownnow guide).
 *  - TIMES are approximate — lawn parties open late afternoon (~5pm), food/
 *    bingo in the evening; fairs run daytime. Exact daily times aren't all
 *    published, so each row uses a typical window and says so in the copy.
 *  - Coords are address/town-level approximations (distance sort only).
 *  - URLs are the organizers' real sites/FB pages or the county events hub.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const EDT = '-04:00';

interface LawnEvent {
  key: string;
  title: string;
  organizer: string;
  url: string;
  venueName: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  startAt: string;
  endAt: string;
  availability: 'free' | 'onsale';
  description: string;
}

// Standard lawn-party blurb.
function lp(organizer: string, dateText: string): string {
  return (
    `${organizer}'s annual lawn party — a Shenandoah Valley summer tradition and ` +
    `fundraiser. Expect classic lawn-party fare (barbecue & fried chicken, ` +
    `burgers, hot dogs, fries, funnel cakes), Bingo, carnival games and rides, ` +
    `and live music. Free admission. ${dateText} Times are approximate — food ` +
    `and rides typically open in the late afternoon/evening; confirm the daily ` +
    `schedule with the organizer.`
  );
}

const EVENTS: LawnEvent[] = [
  {
    key: 'clover-hill-lawn-party-2026-import',
    title: 'Clover Hill Lawn Party',
    organizer: 'Clover Hill Ruritan Club & Fire/Rescue',
    url: 'https://www.facebook.com/p/Clover-Hill-Ruritan-Club-100094321632140/',
    venueName: 'Clover Hill Ruritan Park',
    address: '2100 Clover Hill Rd',
    city: 'Dayton',
    lat: 38.398, lng: -78.985,
    startAt: `2026-06-05T17:00:00${EDT}`, endAt: `2026-06-06T22:00:00${EDT}`,
    availability: 'free',
    description: lp('The Clover Hill Ruritan Club, Fire & Rescue', 'Runs Friday June 5 – Saturday June 6, 2026.'),
  },
  {
    key: 'bergton-fire-car-show-2026-import',
    title: 'Bergton Volunteer Fire Department Car Show',
    organizer: 'Bergton Volunteer Fire Company',
    url: 'https://bergtonfire.com/',
    venueName: 'Bergton Volunteer Fire Company',
    address: 'Bergton',
    city: 'Bergton',
    lat: 38.835, lng: -78.917,
    startAt: `2026-06-06T10:00:00${EDT}`, endAt: `2026-06-06T15:00:00${EDT}`,
    availability: 'free',
    description:
      'The Bergton Volunteer Fire Company’s annual car show in northwestern ' +
      'Rockingham County — show cars, food, and a fundraiser for the fire ' +
      'company. Free to attend (entry fee to register a vehicle). Saturday ' +
      'June 6, 2026; times approximate — confirm with the fire company.',
  },
  {
    key: 'briery-branch-lawn-party-2026-import',
    title: 'Briery Branch Lawn Party',
    organizer: 'Briery Branch',
    url: 'https://www.visitrockingham.com/events/briery-branch-lawn-party',
    venueName: 'Briery Branch Community Center',
    address: '7763 Community Center Rd',
    city: 'Bridgewater',
    lat: 38.40, lng: -79.04,
    startAt: `2026-06-12T17:00:00${EDT}`, endAt: `2026-06-13T22:00:00${EDT}`,
    availability: 'free',
    description:
      'The annual Briery Branch lawn party at the Briery Branch Community ' +
      'Center — food (burgers, hot dogs, fried chicken, funnel cakes, cotton ' +
      'candy), inflatables, games, face painting, music and Bingo, with a ' +
      'beauty pageant June 12 and a parade June 13. Free admission. Runs ' +
      'Friday June 12 – Saturday June 13, 2026; times approximate.',
  },
  {
    key: 'tenth-legion-lawn-party-2026-import',
    title: 'Tenth Legion / Mountain Valley Lawn Party',
    organizer: 'Tenth Legion / Mountain Valley Ruritan Club',
    url: 'https://www.visitrockingham.com/events/tenth-legion-lawn-party-2025',
    venueName: 'Tenth Legion / Mountain Valley Ruritan',
    address: 'Tenth Legion',
    city: 'Tenth Legion',
    lat: 38.62, lng: -78.79,
    startAt: `2026-06-12T17:00:00${EDT}`, endAt: `2026-06-13T22:00:00${EDT}`,
    availability: 'free',
    description: lp('The Tenth Legion / Mountain Valley Ruritan Club', 'Runs Friday June 12 – Saturday June 13, 2026.'),
  },
  {
    key: 'keezletown-lawn-party-2026-import',
    title: 'Keezletown Lawn Party',
    organizer: 'Keezletown Ruritan Club',
    url: 'https://www.keezletownruritan.org/',
    venueName: 'Keezletown Ruritan Club',
    address: '1118 Indian Trail Rd',
    city: 'Keezletown',
    lat: 38.435, lng: -78.77,
    startAt: `2026-06-20T17:00:00${EDT}`, endAt: `2026-06-20T22:00:00${EDT}`,
    availability: 'free',
    description: lp('The Keezletown Ruritan Club', 'Saturday June 20, 2026.'),
  },
  {
    key: 'west-rockingham-lawn-party-2026-import',
    title: 'West Rockingham Ruritan Lawn Party',
    organizer: 'West Rockingham Ruritan Club',
    url: 'https://www.facebook.com/WestRockinghamRuritan/',
    venueName: 'West Rockingham Ruritan Club',
    address: '5413 Rawley Pike',
    city: 'Hinton',
    lat: 38.42, lng: -78.97,
    startAt: `2026-06-27T17:00:00${EDT}`, endAt: `2026-06-27T22:00:00${EDT}`,
    availability: 'free',
    description: lp('The West Rockingham Ruritan Club', 'Saturday June 27, 2026 (some years run Jun 25–27 — confirm).'),
  },
  {
    key: 'mount-crawford-lawn-party-2026-import',
    title: 'Mount Crawford Ruritan Lawn Party',
    organizer: 'Mount Crawford Ruritan Club',
    url: 'https://www.facebook.com/MountCrawfordRuritansForever/',
    venueName: 'Mt. Crawford Ruritan Park',
    address: 'N Main St',
    city: 'Mount Crawford',
    lat: 38.342, lng: -78.944,
    startAt: `2026-07-09T17:00:00${EDT}`, endAt: `2026-07-11T22:00:00${EDT}`,
    availability: 'free',
    description: lp('The Mount Crawford Ruritan Club', 'Runs Thursday July 9 – Saturday July 11, 2026.'),
  },
  {
    key: 'bridgewater-lawn-party-2026-import',
    title: 'Bridgewater Volunteer Fire Company Lawn Party',
    organizer: 'Bridgewater Volunteer Fire Company',
    url: 'https://www.bridgewaterfire.com/',
    venueName: 'Bridgewater Volunteer Fire Company',
    address: '304 N Main St',
    city: 'Bridgewater',
    lat: 38.385, lng: -78.974,
    startAt: `2026-07-15T17:00:00${EDT}`, endAt: `2026-07-18T22:00:00${EDT}`,
    availability: 'free',
    description: lp('The Bridgewater Volunteer Fire Company', 'Runs Wednesday July 15 – Saturday July 18, 2026.'),
  },
  {
    key: 'augusta-county-fair-2026-import',
    title: 'Augusta County Fair',
    organizer: 'Augusta County Fair',
    url: 'https://www.augustacountyfair.net/',
    venueName: 'Augusta Expo',
    address: '277 Expo Rd',
    city: 'Fishersville',
    lat: 38.10, lng: -78.97,
    startAt: `2026-07-21T09:00:00${EDT}`, endAt: `2026-07-25T22:00:00${EDT}`,
    availability: 'onsale',
    description:
      'The Augusta County Fair at Augusta Expo in Fishersville — carnival ' +
      'rides, livestock and exhibits, food, music and grandstand events. ' +
      'Gate admission applies (see the fair site for tickets/hours). Runs ' +
      'July 21–25, 2026. Note: ~39 km from Harrisonburg, outside the default ' +
      'radius.',
  },
  {
    key: 'fulks-run-lawn-party-2026-import',
    title: 'Fulks Run Ruritan Lawn Party',
    organizer: 'Fulks Run Ruritan Club',
    url: 'http://www.fulksrunruritan.com/',
    venueName: 'Fulks Run Ruritan Park',
    address: '15962 Hopkins Gap Rd',
    city: 'Fulks Run',
    lat: 38.78, lng: -78.93,
    startAt: `2026-07-23T17:00:00${EDT}`, endAt: `2026-07-25T22:00:00${EDT}`,
    availability: 'free',
    description: lp('The Fulks Run Ruritan Club', 'Runs Thursday July 23 – Saturday July 25, 2026 at the Ruritan Park on Hopkins Gap Rd. Note: ~37 km from Harrisonburg, outside the default radius.'),
  },
  {
    key: 'mcgaheysville-lawn-party-2026-import',
    title: 'McGaheysville Volunteer Fire Company Lawn Party',
    organizer: 'McGaheysville Volunteer Fire Company',
    url: 'https://mvfd80.org/',
    venueName: 'McGaheysville Volunteer Fire Company',
    address: '80 Stover Dr',
    city: 'McGaheysville',
    lat: 38.367, lng: -78.74,
    startAt: `2026-07-30T17:00:00${EDT}`, endAt: `2026-08-01T22:00:00${EDT}`,
    availability: 'free',
    description: lp('The McGaheysville Volunteer Fire Company', 'Runs Thursday July 30 – Saturday August 1, 2026 (includes a parade).'),
  },
  {
    key: 'rockingham-county-fair-2026-import',
    title: 'Rockingham County Fair',
    organizer: 'Rockingham County Fair',
    url: 'https://www.rockinghamcountyfair.com/',
    venueName: 'Rockingham County Fairgrounds',
    address: '4808 S Valley Pike',
    city: 'Harrisonburg',
    lat: 38.40, lng: -78.86,
    startAt: `2026-08-10T09:00:00${EDT}`, endAt: `2026-08-15T22:00:00${EDT}`,
    availability: 'onsale',
    description:
      'The Rockingham County Fair — one of Virginia’s largest county fairs: ' +
      'carnival rides, livestock shows, agricultural exhibits, food, ' +
      'grandstand concerts and motorsports. Gate admission applies (see the ' +
      'fair site for tickets/hours). Runs August 10–15, 2026 at the ' +
      'Rockingham County Fairgrounds.',
  },
];

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function sourceEventIdFor(title: string, startAt: string): string {
  const stamp = new Date(startAt).toISOString().slice(0, 16).replace(/[T:]/g, '');
  return `manual-${slug(title).slice(0, 80)}-${stamp}`;
}

async function main() {
  let manual = (await db.select().from(sources).where(eq(sources.adapterKey, 'manual')))[0];
  if (!manual) {
    [manual] = await db.insert(sources)
      .values({ adapterKey: 'manual', name: 'Manual entries', enabled: false, config: {} })
      .returning();
    console.log(`[lawn] created sources row (${manual!.id})`);
  } else {
    console.log(`[lawn] reusing existing "Manual entries" source (${manual.id})`);
  }

  let inserted = 0, skipped = 0;
  for (const e of EVENTS) {
    const sourceEventId = sourceEventIdFor(e.title, e.startAt);
    const result = await db.insert(activities).values({
      sourceId: manual!.id,
      sourceEventId,
      title: e.title,
      description: e.description,
      startAt: new Date(e.startAt),
      endAt: new Date(e.endAt),
      timezone: 'America/New_York',
      venueName: e.venueName,
      address: e.address,
      city: e.city,
      region: 'VA',
      country: 'US',
      location: [e.lng, e.lat] as [number, number],
      ageMin: null,
      ageMax: null,
      costMinCents: e.availability === 'free' ? 0 : null,
      costMaxCents: e.availability === 'free' ? 0 : null,
      currency: 'USD',
      availability: e.availability,
      isVirtual: false,
      organizerName: e.organizer,
      organizerUrl: e.url,
      organizerKey: e.key,
      url: e.url,
      imageUrl: null,
      categories: ['festivals', 'community', 'food'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-lawn-parties-2026',
        importedAt: new Date().toISOString(),
      },
    }).onConflictDoNothing().returning({ id: activities.id });

    if (result.length > 0) {
      console.log(`  + ${e.startAt.slice(0, 10)}  ${e.title}`);
      inserted++;
    } else {
      console.log(`  = ${e.startAt.slice(0, 10)}  ${e.title}  (exists)`);
      skipped++;
    }
  }
  console.log(`[lawn] done — inserted=${inserted}, skipped=${skipped}, total=${EVENTS.length}`);
  process.exit(0);
}

main().catch((e) => { console.error('[lawn] failed:', e); process.exit(1); });
