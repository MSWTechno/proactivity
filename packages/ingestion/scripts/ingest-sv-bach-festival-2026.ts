/**
 * One-off ingestion for the 34th Shenandoah Valley Bach Festival,
 * June 8–14, 2026 in Harrisonburg.
 * Source: svbachfestival.org (provided 2026-06-03) + web search for venue/cost.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-sv-bach-festival-2026.ts
 *
 * Idempotent. Single multi-day row for the whole festival week; the full
 * concert schedule/times live on the festival calendar (linked in the copy).
 * Venue = EMU Lehman Auditorium (verified). "Pay what you will" ($10/$25/$40),
 * many events free → availability 'free', cost range 0–$40.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Shenandoah Valley Bach Festival';
const ORGANIZER_KEY = 'sv-bach-festival-2026-import';
const URL = 'https://www.svbachfestival.org/';

const VENUE = {
  name: 'EMU Lehman Auditorium',
  address: '201 Park Pl',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.475,
  lng: -78.875,
};

const EDT = '-04:00';

const EVENT = {
  title: 'Shenandoah Valley Bach Festival',
  startAt: `2026-06-08T19:00:00${EDT}`,
  endAt: `2026-06-14T21:00:00${EDT}`,
  description:
    'The 34th annual Shenandoah Valley Bach Festival — a week of orchestral, ' +
    'chamber, choral, and educational programming celebrating J.S. Bach, themed ' +
    '“Creative Inventions,” presented at Eastern Mennonite University. Most ' +
    'events are free; the full orchestra/choir concerts at Lehman Auditorium ' +
    'are “pay what you will” ($10 / $25 / $40, any seat). Runs June 8–14, 2026 ' +
    '— see svbachfestival.org/calendar for the full concert schedule and times.',
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
    console.log(`[bach] created sources row (${manual!.id})`);
  } else {
    console.log(`[bach] reusing existing "Manual entries" source (${manual.id})`);
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
    costMinCents: 0,
    costMaxCents: 4000,
    currency: 'USD',
    availability: 'free',
    isVirtual: false,
    organizerName: ORGANIZER_NAME,
    organizerUrl: URL,
    organizerKey: ORGANIZER_KEY,
    url: URL,
    imageUrl: null,
    categories: ['music', 'festivals'],
    raw: {
      source: 'admin-manual',
      createdBy: 'script:ingest-sv-bach-festival-2026',
      importedAt: new Date().toISOString(),
    },
  }).onConflictDoNothing().returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[bach] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[bach] done — skipped=1');
  }
  process.exit(0);
}

main().catch((e) => { console.error('[bach] failed:', e); process.exit(1); });
