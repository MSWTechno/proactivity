/**
 * One-off ingestion for Rockingham Recreation Center's open-gym schedule,
 * week of Mon Jun 1 – Sat Jun 6, 2026.
 * Source: flyer image saved 2026-05-31 ("OPEN GYM SCHEDULE — JUNE 1-6").
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
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
const URL = 'https://www.rockinghamcountyva.gov/963/Rockingham-Recreation-Center';

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

// Flyer labels Mon–Sat as June 1–6, 2026.
const DAY: Record<string, string> = {
  mon: '2026-06-01',
  tue: '2026-06-02',
  wed: '2026-06-03',
  thu: '2026-06-04',
  fri: '2026-06-05',
  sat: '2026-06-06',
};

type Slot = [day: keyof typeof DAY | string, start: string, end: string];

interface ActivityDef {
  activity: string;
  slots: Slot[];
}

// Per-activity hours straight off the flyer grid; "NONE" cells dropped.
const SCHEDULE: ActivityDef[] = [
  {
    activity: 'Indoor Track',
    slots: [
      ['mon', '08:00', '20:00'],
      ['tue', '08:00', '20:00'],
      ['wed', '08:00', '20:00'],
      ['thu', '08:00', '20:00'],
      ['fri', '08:00', '20:00'],
      ['sat', '08:00', '14:00'],
    ],
  },
  {
    activity: 'Basketball',
    slots: [
      ['mon', '15:00', '20:00'],
      ['tue', '15:00', '20:00'],
      ['wed', '10:00', '20:00'],
      ['thu', '15:00', '20:00'],
      ['fri', '08:00', '20:00'],
      ['sat', '08:00', '14:00'],
    ],
  },
  {
    activity: 'Volleyball',
    slots: [
      ['mon', '15:00', '20:00'],
      ['tue', '15:00', '20:00'],
      ['wed', '10:00', '20:00'],
      ['thu', '08:00', '20:00'],
      ['fri', '08:00', '20:00'],
      ['sat', '08:00', '14:00'],
    ],
  },
  {
    activity: 'Pickleball',
    slots: [
      ['mon', '08:00', '11:00'],
      ['tue', '15:00', '20:00'],
      ['wed', '10:00', '13:00'],
      ['thu', '08:00', '13:00'],
      ['fri', '08:00', '17:00'],
      ['sat', '08:00', '14:00'],
    ],
  },
  {
    activity: 'Ping Pong',
    slots: [
      ['wed', '08:00', '12:00'],
      ['thu', '08:00', '12:00'],
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
