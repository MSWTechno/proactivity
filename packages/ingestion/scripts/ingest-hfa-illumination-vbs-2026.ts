/**
 * One-off ingestion for Harrisonburg First Assembly's Vacation Bible School
 * "Illumination Station", nightly Sun Jun 14 – Thu Jun 18, 2026.
 * Source: Subsplash event page provided 2026-06-03
 * (subsplash.com/harrisonburgfirstassembl/lb/ev/+br25vcm).
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-hfa-illumination-vbs-2026.ts
 *
 * Idempotent: keys on (sourceId, sourceEventId).
 *
 * Single multi-day row (one VBS program), start Sun 6pm / end Thu 8:30pm.
 * Categories vbs + camps. URL = the real Subsplash event page; coords are a
 * Garbers Church Rd (SW Harrisonburg) approximation — well inside the radius.
 * Starts Jun 14 (>7 days out today), so it surfaces via the VBS filter — which
 * defaults the date window to all-upcoming — rather than the default 7-day view.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Harrisonburg First Assembly of God';
const ORGANIZER_KEY = 'harrisonburg-first-assembly-vbs-2026-import';
const URL = 'https://subsplash.com/harrisonburgfirstassembl/lb/ev/+br25vcm';
const ORGANIZER_URL = 'https://hfachurch.org';

const VENUE = {
  name: 'Harrisonburg First Assembly of God',
  address: '1310 Garbers Church Rd',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.417,
  lng: -78.901,
};

const EDT = '-04:00';

const EVENT = {
  title: 'Illumination Station VBS',
  // Nightly 6:00–8:30 PM, Sun Jun 14 through Thu Jun 18. One multi-day row.
  startAt: `2026-06-14T18:00:00${EDT}`,
  endAt: `2026-06-18T20:30:00${EDT}`,
  description:
    'Harrisonburg First Assembly’s Vacation Bible School — “Illumination ' +
    'Station.” A faith-focused week where kids explore how Jesus brings light ' +
    'into our lives through games, activities, and Bible lessons, with themes ' +
    'of illumination, reflection, and God’s truth. Nightly 6:00–8:30 PM, ' +
    'Sunday June 14 through Thursday June 18. Free. ' +
    'Contact: kids@hfachurch.org or (540) 433-8687.',
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
    console.log(`[hfa-vbs] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[hfa-vbs] reusing existing "Manual entries" source (${manual.id})`);
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
      organizerUrl: ORGANIZER_URL,
      organizerKey: ORGANIZER_KEY,
      url: URL,
      imageUrl: null,
      categories: ['vbs', 'camps'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-hfa-illumination-vbs-2026',
        importedAt: new Date().toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[hfa-vbs] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[hfa-vbs] done — skipped=1 (already present)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[hfa-vbs] failed:', e);
  process.exit(1);
});
