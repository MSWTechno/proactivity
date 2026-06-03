/**
 * One-off ingestion for the Sampson Basketball Academy (SBA) Girls Basketball
 * Camp, Mon Jun 8 – Fri Jun 12, 2026.
 * Source: text file provided 2026-06-03 + web search for venue/URL.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-sba-girls-basketball-camp-2026.ts
 *
 * Idempotent. Single multi-day row (one camp), 8:30am–4:30pm daily.
 * Categories sports + camps. URL = sampsonbasketballacademy.com (verified).
 * VENUE: a dnronline article says Sampson is hosting camp at Horizons Edge
 * (Harrisonburg) — using that (coords reused from the Luxe import there). SBA
 * also operates at Massanutten Resort, so confirm the venue if unsure.
 * Cost not published → availability 'onsale', cost unknown.
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
  title: 'SBA Girls Basketball Camp',
  startAt: `2026-06-08T08:30:00${EDT}`,
  endAt: `2026-06-12T16:30:00${EDT}`,
  description:
    'Sampson Basketball Academy’s Girls Basketball Camp — elite skill ' +
    'development led by NBA Hall of Famer Ralph Sampson, Ralph Sampson III, and ' +
    'Robert Sampson with the SBA training staff. Players work on shooting, ball ' +
    'handling, defense, footwork, and basketball IQ through structured drills, ' +
    'competitive games, and real-game scenarios, with guest appearances, ' +
    'competitions, and prizes. All skill levels welcome. 8:30 AM–4:30 PM daily, ' +
    'Monday June 8 through Friday June 12, 2026. Register at ' +
    'sampsonbasketballacademy.com.',
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
    console.log(`[sba] created sources row (${manual!.id})`);
  } else {
    console.log(`[sba] reusing existing "Manual entries" source (${manual.id})`);
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
      createdBy: 'script:ingest-sba-girls-basketball-camp-2026',
      importedAt: new Date().toISOString(),
    },
  }).onConflictDoNothing().returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[sba] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[sba] done — skipped=1');
  }
  process.exit(0);
}

main().catch((e) => { console.error('[sba] failed:', e); process.exit(1); });
