/**
 * One-off ingestion for Coach Powers Camps (Powers Basketball Camp) overnight
 * camps at Eastern Mennonite University — Girls Jul 13–15 and Boys Jul 20–23,
 * 2026. Source: flyer image (Downloads 2026-06-04).
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-powers-basketball-camp-2026.ts
 *
 * Idempotent. One multi-day row per session (overnight/residential). Rising
 * 4th–12th grade. Venue + URL from the flyer (EMU; powersbballcamp.com).
 * TIMES: these are overnight camps and the flyer lists no check-in/pickup
 * times — start time is a neutral placeholder (date range is what's accurate);
 * the copy says "overnight — see registration for check-in/pickup."
 * Cost: discounts available but no price published → availability 'onsale'.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Coach Powers Camps';
const ORGANIZER_KEY = 'powers-basketball-camp-2026-import';
const URL = 'https://www.powersbballcamp.com';

const VENUE = {
  name: 'Eastern Mennonite University',
  address: '1200 Park Rd',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.4756,
  lng: -78.8746,
};

const EDT = '-04:00';

interface CampEvent {
  title: string;
  who: string;
  startAt: string;
  endAt: string;
  dateText: string;
}

const EVENTS: CampEvent[] = [
  {
    title: 'Coach Powers Girls Overnight Basketball Camp',
    who: 'girls',
    startAt: `2026-07-13T09:00:00${EDT}`,
    endAt: `2026-07-15T17:00:00${EDT}`,
    dateText: 'July 13–15, 2026',
  },
  {
    title: 'Coach Powers Boys Overnight Basketball Camp',
    who: 'boys',
    startAt: `2026-07-20T09:00:00${EDT}`,
    endAt: `2026-07-23T17:00:00${EDT}`,
    dateText: 'July 20–23, 2026',
  },
];

function descFor(e: CampEvent): string {
  return (
    `Coach Powers Camps ${e.who} overnight basketball camp at Eastern Mennonite ` +
    `University for rising 4th–12th graders. A residential camp with skill ` +
    `development, games, and competition. ${e.dateText} (overnight — see ` +
    `registration for check-in/pickup times). Discounts available; some age ` +
    `groups sold out last year, so register early at powersbballcamp.com ` +
    `(contact justin@powersbballcamp.com).`
  );
}

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
    console.log(`[powers] created sources row (${manual!.id})`);
  } else {
    console.log(`[powers] reusing existing "Manual entries" source (${manual.id})`);
  }

  let inserted = 0, skipped = 0;
  for (const e of EVENTS) {
    const sourceEventId = sourceEventIdFor(e.title, e.startAt);
    const result = await db.insert(activities).values({
      sourceId: manual!.id,
      sourceEventId,
      title: e.title,
      description: descFor(e),
      startAt: new Date(e.startAt),
      endAt: new Date(e.endAt),
      timezone: 'America/New_York',
      venueName: VENUE.name,
      address: VENUE.address,
      city: VENUE.city,
      region: VENUE.region,
      country: 'US',
      location: [VENUE.lng, VENUE.lat] as [number, number],
      ageMin: 9,
      ageMax: 18,
      costMinCents: null,
      costMaxCents: null,
      currency: 'USD',
      availability: 'onsale',
      isVirtual: false,
      organizerName: ORGANIZER_NAME,
      organizerUrl: URL,
      organizerKey: ORGANIZER_KEY,
      url: URL,
      imageUrl: null,
      categories: ['sports', 'camps', 'basketball'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-powers-basketball-camp-2026',
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
  console.log(`[powers] done — inserted=${inserted}, skipped=${skipped}, total=${EVENTS.length}`);
  process.exit(0);
}

main().catch((e) => { console.error('[powers] failed:', e); process.exit(1); });
