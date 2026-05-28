/**
 * One-off ingestion for Rocktown Volleyball Club's Summer 2026 schedule.
 * Source flyer: instagram.com/p/(post from 2026-05-25); details cross-checked
 * against rocktownvolleyballclub.com/upcoming-events and /registration.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-rovo-2026.ts
 *
 * Idempotent: each row keys on (sourceId, sourceEventId) via
 * `activities_source_event_unique`, so re-running is a no-op.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Rocktown Volleyball Club';
const ORGANIZER_URL = 'https://www.rocktownvolleyballclub.com';
const UPCOMING_URL = 'https://www.rocktownvolleyballclub.com/upcoming-events';
const REGISTRATION_URL = 'https://www.rocktownvolleyballclub.com/registration';

interface Venue {
  name: string;
  address: string | null;
  city: string;
  region: string;
  lat: number;
  lng: number;
}

const EMS: Venue = {
  name: 'Eastern Mennonite School',
  address: '801 Parkwood Dr',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.4604,
  lng: -78.8650,
};

const ROCKINGHAM_REC: Venue = {
  name: 'Rockingham Rec Center',
  address: null,
  city: 'Penn Laird',
  region: 'VA',
  lat: 38.4153,
  lng: -78.7745,
};

const CORNERSTONE: Venue = {
  name: 'Cornerstone Christian School',
  address: '197 Cornerstone Ln',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.4850,
  lng: -78.8700,
};

interface EventDef {
  title: string;
  description: string;
  startAt: string;
  endAt: string | null;
  venue: Venue;
  url: string;
  categories: string[];
  availability: 'onsale' | 'free' | 'dropin' | 'sold_out' | 'cancelled' | 'unknown';
  ageMin: number | null;
  ageMax: number | null;
  costMinCents: number | null;
  costMaxCents: number | null;
}

const CLINIC_DESC =
  'Open to rising 6th–12th grade boys, all skill levels. No previous volleyball experience required. $5 per session. Walk-in welcome — pay at the door.';

const BOYS_CAMP_DESC =
  'Two-day boys volleyball camp. Morning session (8:00–11:00am): rising 5th–8th grade. Afternoon session (12:30–3:30pm): rising 9th–12th grade. $90 for both days, includes a club t-shirt.';

const GIRLS_CAMP_DESC =
  'Four-day girls volleyball camp. JV session (8:00–11:00am): rising 8th–10th grade — $160. Varsity session (12:30–3:30pm): rising 10th–12th grade — $185.';

const OPEN_PLAY_DESC =
  'Grass volleyball open play — quads, doubles, and/or sixes. Open to athletes 13+ of any skill or experience level. Free for ages 13–18, $5 per session for adults. Waiver required (youth and adult versions on the club website).';

const TOURNAMENT_DESC =
  'Outdoor grass volleyball tournament. First serve 9:00am sharp; check-in 8:00–8:30am (mandatory), info meeting 8:40am. Divisions: Men\'s & Women\'s Doubles (AA/A/BB-B), Junior Girls Quads (A & B). Entry: $32 early / $37 regular per player for adult doubles; $22 early / $25 regular per player for junior quads. Boxed lunches included. Bring tents, umbrellas, coolers. No alcohol on site. Ball: Wilson OPTX. Rally scoring.';

// All times America/New_York (EDT in May/Jun/Jul → UTC-04:00). Using explicit
// offsets so the ISO strings are unambiguous regardless of host timezone.
const EDT = '-04:00';

function at(date: string, time: string): string {
  return `${date}T${time}${EDT}`;
}

const events: EventDef[] = [
  // Boys Volleyball Clinics — 6 Tuesdays, Jun 2 – Jul 7, 6–8pm @ EMS
  ...['2026-06-02', '2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30', '2026-07-07'].map(
    (d): EventDef => ({
      title: 'Rocktown Boys Volleyball Clinic',
      description: CLINIC_DESC,
      startAt: at(d, '18:00:00'),
      endAt: at(d, '20:00:00'),
      venue: EMS,
      url: UPCOMING_URL,
      categories: ['sports', 'family'],
      availability: 'onsale',
      ageMin: 11,
      ageMax: 18,
      costMinCents: 500,
      costMaxCents: 500,
    }),
  ),

  // Boys Volleyball Summer Camp — Jun 25–26, two-day, $90
  {
    title: 'Rocktown Boys Volleyball Summer Camp',
    description: BOYS_CAMP_DESC,
    startAt: at('2026-06-25', '08:00:00'),
    endAt: at('2026-06-26', '15:30:00'),
    venue: EMS,
    url: UPCOMING_URL,
    categories: ['sports', 'family'],
    availability: 'onsale',
    ageMin: 10,
    ageMax: 18,
    costMinCents: 9000,
    costMaxCents: 9000,
  },

  // Girls Volleyball Summer Camp — Jul 13–16, four-day
  {
    title: 'Rocktown Girls Volleyball Summer Camp',
    description: GIRLS_CAMP_DESC,
    startAt: at('2026-07-13', '08:00:00'),
    endAt: at('2026-07-16', '15:30:00'),
    venue: ROCKINGHAM_REC,
    url: UPCOMING_URL,
    categories: ['sports', 'family'],
    availability: 'onsale',
    ageMin: 13,
    ageMax: 18,
    costMinCents: 16000,
    costMaxCents: 18500,
  },

  // Grass Open Play — 4 Fridays, 6:00–8:30pm @ Cornerstone
  ...['2026-06-05', '2026-06-19', '2026-07-03', '2026-07-10'].map(
    (d): EventDef => ({
      title: 'Rocktown Grass Volleyball Open Play',
      description: OPEN_PLAY_DESC,
      startAt: at(d, '18:00:00'),
      endAt: at(d, '20:30:00'),
      venue: CORNERSTONE,
      url: UPCOMING_URL,
      categories: ['sports', 'outdoor'],
      availability: 'dropin',
      ageMin: 13,
      ageMax: null,
      costMinCents: 0,
      costMaxCents: 500,
    }),
  ),

  // May 30 Grass Tournament — first serve 9am, end time not published
  {
    title: 'Rocktown Grass Volleyball Tournament — May 30',
    description: TOURNAMENT_DESC,
    startAt: at('2026-05-30', '09:00:00'),
    endAt: null,
    venue: CORNERSTONE,
    url: REGISTRATION_URL,
    categories: ['sports', 'outdoor'],
    availability: 'onsale',
    ageMin: 12,
    ageMax: null,
    costMinCents: 2200,
    costMaxCents: 3700,
  },
];

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sourceEventIdFor(e: EventDef): string {
  // Mirrors the POST /api/admin/events/new convention so a row inserted by
  // this script is indistinguishable from one created via the admin form.
  const stamp = new Date(e.startAt).toISOString().slice(0, 16).replace(/[T:]/g, '');
  return `manual-${slug(e.title).slice(0, 80)}-${stamp}`;
}

async function main() {
  // Find-or-create the "Manual entries" source, same as the admin route does.
  let manual = (await db.select().from(sources).where(eq(sources.adapterKey, 'manual')))[0];
  if (!manual) {
    [manual] = await db
      .insert(sources)
      .values({
        adapterKey: 'manual',
        name: 'Manual entries',
        enabled: false,
        config: {},
      })
      .returning();
    console.log(`[rovo] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[rovo] reusing existing "Manual entries" source (${manual.id})`);
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
        endAt: e.endAt ? new Date(e.endAt) : null,
        timezone: 'America/New_York',
        venueName: e.venue.name,
        address: e.venue.address,
        city: e.venue.city,
        region: e.venue.region,
        country: 'US',
        location: [e.venue.lng, e.venue.lat] as [number, number],
        ageMin: e.ageMin,
        ageMax: e.ageMax,
        costMinCents: e.costMinCents,
        costMaxCents: e.costMaxCents,
        currency: 'USD',
        availability: e.availability,
        isVirtual: false,
        organizerName: ORGANIZER_NAME,
        organizerUrl: ORGANIZER_URL,
        organizerKey: 'rovo-2026-import',
        url: e.url,
        imageUrl: null,
        categories: e.categories,
        raw: {
          source: 'admin-manual',
          createdBy: 'script:ingest-rovo-2026',
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

  console.log(`[rovo] done — inserted=${inserted}, skipped=${skipped}, total=${events.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[rovo] failed:', e);
  process.exit(1);
});
