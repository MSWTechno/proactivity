/**
 * One-off ingestion for ACTSports' Summer 2026 Volleyball Clinics.
 * Source: https://www.playactsports.com/vbclinics (schedule + divisions),
 * cost ($20/clinic) and venue (Victory Worship Center) per organizer.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-acts-vb-clinics-2026.ts
 *
 * Idempotent: each row keys on (sourceId, sourceEventId) via
 * `activities_source_event_unique`, so re-running is a no-op.
 *
 * One row per division per clinic day. The page warns "exact days and times
 * may vary slightly," so descriptions note that. Venue is Victory Worship
 * Center, 200 Hammond Lane, Staunton — ACTS runs the clinics out of that
 * church's gym (geocoded via Nominatim). NOTE: ~26mi from Harrisonburg, just
 * outside the default 25mi feed radius.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'ACTSports';
const ORGANIZER_URL = 'https://www.playactsports.com/vbclinics';
const REGISTRATION_URL = 'https://playactsports.sportngin.com/register/form/842075197';

const VENUE = {
  name: 'Victory Worship Center',
  address: '200 Hammond Lane',
  city: 'Staunton',
  region: 'VA',
  lat: 38.1032,
  lng: -79.0602,
};

// $20 per clinic.
const COST_CENTS = 2000;

// EDT (Jun/Jul → UTC-04:00). Explicit offsets so ISO strings are unambiguous.
const EDT = '-04:00';

// Series runs Jun 8 – Jul 16, 2026. 6 Mondays + 6 Thursdays.
const MONDAYS = ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13'];
const THURSDAYS = ['2026-06-11', '2026-06-18', '2026-06-25', '2026-07-02', '2026-07-09', '2026-07-16'];

interface ClinicDef {
  title: string;
  description: string;
  dates: string[];
  start: string; // HH:mm 24h
  end: string;
}

const MS_DESC =
  'ACTS Summer Volleyball Clinic for middle schoolers. Open to 6th–8th graders planning to try out for their middle school team in 2026–2027. Small-group, skill-focused coaching. $20 per clinic; register online. Exact days/times may vary slightly — confirm at registration.';

const HS_DESC =
  'ACTS Summer Volleyball Clinic for high schoolers. Open to 8th–12th graders planning to try out for JV or Varsity in 2026–2027. Small-group, skill-focused coaching. $20 per clinic; register online. Exact days/times may vary slightly — confirm at registration.';

// Per the page's "General Clinic Schedule". High-school Monday lists two
// back-to-back 90-min slots (10:30–12:00, 12:00–1:30) → modeled as one
// 10:30–1:30 block per day. Thursday HS has a daytime block plus a separate
// evening session (4-hr gap), so they're kept as distinct rows.
const CLINICS: ClinicDef[] = [
  // Middle School
  { title: 'ACTS Middle School Volleyball Clinic', description: MS_DESC, dates: MONDAYS, start: '17:30', end: '19:00' },
  { title: 'ACTS Middle School Volleyball Clinic', description: MS_DESC, dates: THURSDAYS, start: '19:00', end: '20:30' },
  // High School
  { title: 'ACTS High School Volleyball Clinic', description: HS_DESC, dates: MONDAYS, start: '10:30', end: '13:30' },
  { title: 'ACTS High School Volleyball Clinic', description: HS_DESC, dates: THURSDAYS, start: '10:30', end: '13:30' },
  { title: 'ACTS High School Volleyball Clinic', description: HS_DESC, dates: THURSDAYS, start: '17:30', end: '19:00' },
];

interface EventRow {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
}

const events: EventRow[] = CLINICS.flatMap((c) =>
  c.dates.map((date): EventRow => ({
    title: c.title,
    description: c.description,
    startAt: `${date}T${c.start}:00${EDT}`,
    endAt: `${date}T${c.end}:00${EDT}`,
  })),
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
  // Mirrors the POST /api/admin/events/new convention. Includes the start
  // time so same-day MS-vs-HS (and the two Thursday HS sessions) stay distinct.
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
    console.log(`[acts] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[acts] reusing existing "Manual entries" source (${manual.id})`);
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
        costMinCents: COST_CENTS,
        costMaxCents: COST_CENTS,
        currency: 'USD',
        availability: 'onsale',
        isVirtual: false,
        organizerName: ORGANIZER_NAME,
        organizerUrl: ORGANIZER_URL,
        organizerKey: 'acts-vb-clinics-2026-import',
        url: REGISTRATION_URL,
        imageUrl: null,
        categories: ['sports'],
        raw: {
          source: 'admin-manual',
          createdBy: 'script:ingest-acts-vb-clinics-2026',
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

  console.log(`[acts] done — inserted=${inserted}, skipped=${skipped}, total=${events.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[acts] failed:', e);
  process.exit(1);
});
