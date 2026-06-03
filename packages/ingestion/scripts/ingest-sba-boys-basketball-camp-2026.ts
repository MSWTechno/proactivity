/**
 * One-off ingestion for the Sampson Basketball Academy (SBA) Boys Basketball
 * Camp, Mon Jul 6 – Fri Jul 10, 2026. Companion to the girls session
 * (ingest-sba-girls-basketball-camp-2026.ts). Source: SBA summer-camps flyer
 * image (Downloads 2026-06-03).
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-sba-boys-basketball-camp-2026.ts
 *
 * Idempotent. Single multi-day row. Venue CONFIRMED by the flyer: Horizon Edge
 * Sports Complex, 325 Cornerstone Lane, Harrisonburg. Reuses the SBA organizer.
 * TIME: the flyer doesn't list a daily time for the boys session — assuming
 * 8:30am–4:30pm to match the girls session (verify). Cost not published →
 * availability 'onsale', cost unknown.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Sampson Basketball Academy';
const ORGANIZER_KEY = 'sampson-basketball-academy-2026-import';
const URL = 'https://www.sampsonbasketballacademy.com/';

const VENUE = {
  name: 'Horizons Edge Sports Campus',
  address: '325 Cornerstone Ln, Harrisonburg, VA 22802',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.4727265,
  lng: -78.818272,
};

const EDT = '-04:00';

const EVENT = {
  title: 'SBA Boys Basketball Camp',
  // Boys session Jul 6-10; time assumed 8:30am-4:30pm (same as girls session).
  startAt: `2026-07-06T08:30:00${EDT}`,
  endAt: `2026-07-10T16:30:00${EDT}`,
  description:
    'Sampson Basketball Academy’s Boys Basketball Camp — elite skill ' +
    'development led by NBA Hall of Famer and UVA great Ralph Sampson, with ' +
    'sons Ralph Sampson III and Robert Sampson (both pro players) and the SBA ' +
    'training staff, plus special guests. Players work on shooting, ball ' +
    'handling, defense, footwork, and basketball IQ through drills, competitive ' +
    'games, and real-game scenarios. All skill levels welcome. Monday July 6 ' +
    'through Friday July 10, 2026 (approx. 8:30 AM–4:30 PM) at Horizons Edge ' +
    'Sports Campus, Harrisonburg. Register at sampsonbasketballacademy.com.',
};

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
    console.log(`[sba-boys] created sources row (${manual!.id})`);
  } else {
    console.log(`[sba-boys] reusing existing "Manual entries" source (${manual.id})`);
  }

  const sourceEventId = sourceEventIdFor(EVENT.title, EVENT.startAt);
  const result = await db.insert(activities).values({
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
      createdBy: 'script:ingest-sba-boys-basketball-camp-2026',
      importedAt: new Date().toISOString(),
    },
  }).onConflictDoNothing().returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[sba-boys] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[sba-boys] done — skipped=1');
  }
  process.exit(0);
}

main().catch((e) => { console.error('[sba-boys] failed:', e); process.exit(1); });
