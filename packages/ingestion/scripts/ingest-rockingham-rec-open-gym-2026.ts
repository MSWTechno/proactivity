/**
 * One-off ingestion for Rockingham Recreation Center's open-gym schedule,
 * week of Mon Jun 15 – Sat Jun 20, 2026.
 * Source: flyer image saved 2026-06-15 ("OPEN GYM SCHEDULE — JUNE 15-20").
 * (Re-pointed each week; prior weeks' rows age off via the end_at >= now() filter.)
 *
 * Run (from packages/ingestion):
 *   pnpm exec tsx --env-file=D:/workspaces/proactivity/.env \
 *     scripts/ingest-rockingham-rec-open-gym-2026.ts
 *
 * Idempotent: each row keys on (sourceId, sourceEventId) via
 * `activities_source_event_unique`, so re-running is a no-op.
 *
 * One activity row per sport per day; "NONE" cells are omitted. Venue coords
 * reused from ingest-rovo-2026.ts (Rockingham Rec, Penn Laird) — address still
 * unknown. Cost: $5 per visit for every activity except Indoor Track (left
 * null/unknown). Flyer also lists an 11-visit / $50 punch pass (in description).
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Rockingham Recreation Center';
const PHONE = '(540) 564-3160';
// Canonical page — required: the homepage feed (/api/activities) drops any
// activity with a null/empty url (they'd render as dead "#" links).
const URL = 'https://www.facebook.com/rockinghamcountyrecreation';

const VENUE = {
  name: 'Rockingham Recreation Center',
  address: '1 Rockingham Park Way',
  city: 'Penn Laird',
  region: 'VA',
  lat: 38.4153,
  lng: -78.7745,
};

// EDT (June → UTC-04:00). Explicit offsets so ISO strings are unambiguous.
const EDT = '-04:00';

// Flyer labels Mon–Fri as June 15–19, 2026. Saturday Jun 20 is CLOSED
// ("NO OPEN GYM OR WALKING — hosting Rocktown Volleyball Tournament"), so no
// sat slots this week.
const DAY: Record<string, string> = {
  mon: '2026-06-15',
  tue: '2026-06-16',
  wed: '2026-06-17',
  thu: '2026-06-18',
  fri: '2026-06-19',
};

type Slot = [day: keyof typeof DAY | string, start: string, end: string];

interface ActivityDef {
  activity: string;
  slots: Slot[];
}

// Per-activity hours straight off the flyer grid; "NONE" cells dropped.
// (Walker icon = Indoor Track / walking; ping pong is NONE every day this week.)
const SCHEDULE: ActivityDef[] = [
  {
    activity: 'Indoor Track',
    slots: [
      ['mon', '08:00', '15:00'],
      ['tue', '08:00', '15:00'],
      ['wed', '08:00', '15:00'],
      ['thu', '08:00', '15:00'],
      ['fri', '11:00', '20:00'],
    ],
  },
  {
    activity: 'Basketball',
    slots: [
      ['mon', '10:00', '16:00'],
      ['tue', '08:00', '16:00'],
      ['wed', '08:00', '16:00'],
      ['thu', '08:00', '16:00'],
    ],
  },
  {
    activity: 'Volleyball',
    slots: [
      ['fri', '11:00', '17:00'],
    ],
  },
  {
    activity: 'Pickleball',
    slots: [
      ['mon', '10:00', '14:00'],
      ['tue', '08:00', '10:00'],
      ['wed', '08:00', '14:00'],
      ['thu', '08:00', '14:00'],
      ['fri', '15:00', '18:00'],
    ],
  },
];

interface EventRow {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  costCents: number | null;
}

function descFor(activity: string, costCents: number | null): string {
  const price =
    costCents != null
      ? `$${(costCents / 100).toFixed(0)} per visit (or 11-visit punch pass for $50). `
      : `11-visit punch pass for $50. `;
  return (
    `Drop-in ${activity.toLowerCase()} during open gym at the Rockingham ` +
    `Recreation Center. Walk-up — no registration. ${price}` +
    `Hours subject to change; call ${PHONE} to confirm.`
  );
}

const events: EventRow[] = SCHEDULE.flatMap(({ activity, slots }) =>
  slots.map(([day, start, end]): EventRow => {
    const date = DAY[day];
    // $5 per visit for everything except Indoor Track (price not on the flyer).
    const costCents = activity === 'Indoor Track' ? null : 500;
    return {
      title: `${activity} Open Gym`,
      description: descFor(activity, costCents),
      startAt: `${date}T${start}:00${EDT}`,
      endAt: `${date}T${end}:00${EDT}`,
      costCents,
    };
  }),
);

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sourceEventIdFor(e: EventRow): string {
  // Mirrors the POST /api/admin/events/new convention.
  const stamp = new Date(e.startAt).toISOString().slice(0, 16).replace(/[T:]/g, '');
  return `manual-${slug(e.title).slice(0, 80)}-${stamp}`;
}

async function main() {
  let manual = (await db.select().from(sources).where(eq(sources.adapterKey, 'manual')))[0];
  if (!manual) {
    [manual] = await db
      .insert(sources)
      .values({ adapterKey: 'manual', name: 'Manual entries', enabled: false, config: {} })
      .returning();
    console.log(`[rrc] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[rrc] reusing existing "Manual entries" source (${manual.id})`);
  }

  let inserted = 0;
  let skipped = 0;

  for (const e of events) {
    const sourceEventId = sourceEventIdFor(e);
    const result = await db
      .insert(activities)
      .values({
        sourceId: manual!.id,
        sourceEventId,
        title: e.title,
        description: e.description,
        startAt: new Date(e.startAt),
        endAt: new Date(e.endAt),
        timezone: 'America/New_York',
        venueName: VENUE.name,
        address: VENUE.address,
        city: VENUE.city,
        region: VENUE.region,
        country: 'US',
        location: [VENUE.lng, VENUE.lat] as [number, number],
        ageMin: null,
        ageMax: null,
        costMinCents: e.costCents,
        costMaxCents: e.costCents,
        currency: 'USD',
        availability: 'dropin',
        isVirtual: false,
        organizerName: ORGANIZER_NAME,
        organizerUrl: URL,
        organizerKey: 'rockingham-rec-2026-import',
        url: URL,
        imageUrl: null,
        categories: ['sports'],
        raw: {
          source: 'admin-manual',
          createdBy: 'script:ingest-rockingham-rec-open-gym-2026',
          importedAt: new Date().toISOString(),
        },
      })
      .onConflictDoNothing()
      .returning({ id: activities.id });

    if (result.length > 0) {
      console.log(`  + ${e.startAt.slice(0, 16)}  ${e.title}  (${result[0]!.id})`);
      inserted++;
    } else {
      console.log(`  = ${e.startAt.slice(0, 16)}  ${e.title}  (already exists)`);
      skipped++;
    }
  }

  console.log(`[rrc] done — inserted=${inserted}, skipped=${skipped}, total=${events.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[rrc] failed:', e);
  process.exit(1);
});
