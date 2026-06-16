/**
 * One-off ingestion for Broadway Volleyball's "Junior Gobblers Volleyball Camp",
 * Mon Jul 27 – Wed Jul 29, 2026, 9:00 AM – 12:00 PM at Broadway High School.
 * Source: flyer image saved to Downloads 2026-06-15 (unnamed.png).
 *
 * Run (from packages/ingestion):
 *   pnpm exec tsx --env-file=D:/workspaces/proactivity/.env \
 *     scripts/ingest-junior-gobblers-volleyball-camp-2026.ts
 *
 * Idempotent: keys on (sourceId, sourceEventId).
 *
 * Single multi-day row (one camp you register for, not drop-in days): start Mon
 * 9am, end Wed 12pm. Categories camps + sports + volleyball (Camps chip ->
 * Sports facet, plus the volleyball facet). Registration URL decoded from the
 * flyer's QR code (Google Form). Coords geocoded from Broadway HS via Nominatim
 * (~22 km from Harrisonburg, inside the radius).
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Broadway Volleyball';
const ORGANIZER_KEY = 'junior-gobblers-vb-camp-2026-import';
// Canonical page — the QR-code registration form off the flyer.
const URL = 'https://forms.gle/ybMLiX9TiB9tp5or9';

const VENUE = {
  name: 'Broadway High School',
  address: '269 Gobbler Drive',
  city: 'Broadway',
  region: 'VA',
  lat: 38.6074025,
  lng: -78.7944382,
};

const EDT = '-04:00'; // July → UTC-04:00

const EVENT = {
  title: 'Junior Gobblers Volleyball Camp',
  // Daily 9 AM–12 PM, Mon Jul 27 through Wed Jul 29. Modeled as one multi-day row.
  startAt: `2026-07-27T09:00:00${EDT}`,
  endAt: `2026-07-29T12:00:00${EDT}`,
  description:
    'Broadway Volleyball hosts its youth Junior Gobblers Volleyball Camp — ' +
    'three days of foundational volleyball and teamwork skills (and fun) for ' +
    'rising 4th–8th graders in Rockingham County and surrounding localities. ' +
    'July 27–29, 2026, 9:00 AM–12:00 PM at Broadway High School, led by ' +
    'Broadway volleyball players and staff. $60, due via cash or check. ' +
    'Register at forms.gle/ybMLiX9TiB9tp5or9. Questions: Coach Coffman, ' +
    'scoffman@rockingham.k12.va.us.',
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
    console.log(`[jr-gobblers] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[jr-gobblers] reusing existing "Manual entries" source (${manual.id})`);
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
      ageMin: 9,
      ageMax: 14,
      costMinCents: 6000,
      costMaxCents: 6000,
      currency: 'USD',
      availability: 'onsale',
      isVirtual: false,
      organizerName: ORGANIZER_NAME,
      organizerUrl: URL,
      organizerKey: ORGANIZER_KEY,
      url: URL,
      imageUrl: null,
      categories: ['camps', 'sports', 'volleyball'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-junior-gobblers-volleyball-camp-2026',
        importedAt: new Date().toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[jr-gobblers] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[jr-gobblers] done — skipped=1 (already present)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[jr-gobblers] failed:', e);
  process.exit(1);
});
