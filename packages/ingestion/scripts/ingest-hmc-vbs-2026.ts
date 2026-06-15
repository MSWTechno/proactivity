/**
 * One-off ingestion for Harrisonburg Mennonite Church's Vacation Bible School,
 * nightly Mon Jul 13 – Thu Jul 16, 2026, 6:00–8:00 PM.
 * Source: https://harrisonburgmennonite.org/vacation-bible-school (fetched 2026-06-15).
 *
 * Run (from packages/ingestion):
 *   pnpm exec tsx --env-file=D:/workspaces/proactivity/.env \
 *     scripts/ingest-hmc-vbs-2026.ts
 *
 * Idempotent: keys on (sourceId, sourceEventId).
 *
 * Single multi-day row (one VBS program you register for, not drop-in nights):
 * start Mon 6pm, end Thu 8pm. Categories vbs + camps (VBS is a camps
 * specialization — see apps/web/lib/categories.ts). Coords geocoded from the
 * street address via Nominatim (exact match, ~2.5 km from Harrisonburg center).
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Harrisonburg Mennonite Church';
const ORGANIZER_KEY = 'hmc-vbs-2026-import';
// Canonical page — the VBS info page (has the registration form + meal details).
const URL = 'https://harrisonburgmennonite.org/vacation-bible-school';

const VENUE = {
  name: 'Harrisonburg Mennonite Church',
  address: '1552 South High Street',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.4329204,
  lng: -78.8934492,
};

const EDT = '-04:00'; // July → UTC-04:00

const EVENT = {
  title: 'Vacation Bible School at Harrisonburg Mennonite',
  // Nightly 6–8 PM, Mon Jul 13 through Thu Jul 16. Modeled as one multi-day row.
  startAt: `2026-07-13T18:00:00${EDT}`,
  endAt: `2026-07-16T20:00:00${EDT}`,
  description:
    'Harrisonburg Mennonite Church invites children going into K through ' +
    'grade 6 (2026-27) to a week of Vacation Bible School, July 13–16, ' +
    '6:00–8:00 PM. The theme follows Micah 6:8 — "to act justly, love mercy, ' +
    'and walk humbly with your God" — with worship, creative projects, ' +
    'learning, and movement each night. A provided meal begins at 5:15 PM and ' +
    'check-in opens at 5:50 PM. Free. Register via the online form ' +
    '(forms.gle/PGScLEmkv9s4W5Lx8); registration closes July 8. ' +
    'Questions: (540) 434-4463 or hmc@harrisonburgmennonite.org.',
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
    console.log(`[hmc-vbs] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[hmc-vbs] reusing existing "Manual entries" source (${manual.id})`);
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
      ageMin: 5,
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
        createdBy: 'script:ingest-hmc-vbs-2026',
        importedAt: new Date().toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning({ id: activities.id });

  if (result.length > 0) {
    console.log(`  + ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (${result[0]!.id})`);
    console.log('[hmc-vbs] done — inserted=1');
  } else {
    console.log(`  = ${EVENT.startAt.slice(0, 16)}  ${EVENT.title}  (already exists)`);
    console.log('[hmc-vbs] done — skipped=1 (already present)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[hmc-vbs] failed:', e);
  process.exit(1);
});
