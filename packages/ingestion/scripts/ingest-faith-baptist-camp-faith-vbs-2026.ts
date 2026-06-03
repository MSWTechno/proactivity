/**
 * One-off ingestion for Faith Baptist Church's VBS "Camp Faith",
 * Mon Jun 8 – Wed Jun 10, 2026.
 * Source: flyer image saved to Downloads 2026-06-03.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-faith-baptist-camp-faith-vbs-2026.ts
 *
 * Idempotent. Single multi-day row, 6:15–8:30pm daily. Categories vbs + camps.
 * Venue/URL verified via web search (faithbaptistbroadway.org; 675 Early Dr,
 * Broadway). Coords are a Broadway approximation (~20 km from Harrisonburg,
 * inside the radius). Flyer registration was QR-only; url = church site.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Faith Baptist Church';
const ORGANIZER_KEY = 'faith-baptist-camp-faith-vbs-2026-import';
const URL = 'https://faithbaptistbroadway.org';

const VENUE = {
  name: 'Faith Baptist Church',
  address: '675 Early Dr',
  city: 'Broadway',
  region: 'VA',
  lat: 38.611,
  lng: -78.799,
};

const EDT = '-04:00';

const EVENT = {
  title: 'Camp Faith VBS',
  startAt: `2026-06-08T18:15:00${EDT}`,
  endAt: `2026-06-10T20:30:00${EDT}`,
  description:
    'Faith Baptist Church Vacation Bible School — “Camp Faith”: Serving Jesus ' +
    'is the Greatest Adventure! Games, Bible lessons, and fun for ages 4–12. ' +
    '6:15–8:30 PM, Monday June 8 through Wednesday June 10. Register via ' +
    'faithbaptistbroadway.org.',
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
    console.log(`[camp-faith] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[camp-faith] reusing existing "Manual entries" source (${manual.id})`);
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
      ageMin: 4,
      ageMax: 12,
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
        createdBy: 'script:ingest-faith-baptist-camp-faith-vbs-2026',
        importedAt: new Date().toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[camp-faith] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[camp-faith] done — skipped=1 (already present)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[camp-faith] failed:', e);
  process.exit(1);
});
