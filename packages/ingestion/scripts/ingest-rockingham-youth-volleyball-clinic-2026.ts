/**
 * One-off ingestion for Rockingham County Parks & Recreation's Youth Volleyball
 * Clinic — Tuesdays & Thursdays, Jun 23 – Jul 30, 2026, at the Rockingham Rec
 * Center. Source: flyer image + Facebook post (Downloads 2026-06-03).
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-rockingham-youth-volleyball-clinic-2026.ts
 *
 * Idempotent. One row per grade division (different times); each modeled as a
 * multi-day series (start = first session, end = last session) with the
 * Tue/Thu cadence in the copy. $65, register by Jun 21. Reuses the existing
 * rockingham-rec-2026-import organizer + the Penn Laird rec-center coords.
 * URLs are the resolved rec1 registration links (from the post's tinyurls).
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Rockingham County Parks & Recreation';
const ORGANIZER_KEY = 'rockingham-rec-2026-import';
const ORGANIZER_URL = 'https://www.facebook.com/rockinghamcountyrecreation';

const VENUE = {
  name: 'Rockingham Recreation Center',
  address: '1 Rockingham Park Way',
  city: 'Penn Laird',
  region: 'VA',
  lat: 38.4153,
  lng: -78.7745,
};

const EDT = '-04:00';

interface ClinicEvent {
  title: string;
  grade: string;
  startAt: string;
  endAt: string;
  ageMin: number;
  ageMax: number;
  url: string;
}

const EVENTS: ClinicEvent[] = [
  {
    title: 'Youth Volleyball Clinic (3rd–5th Grade)',
    grade: '3rd–5th grade',
    // Tue/Thu Jun 23 – Jul 30; 5:30–6:45 PM. Series start..last session.
    startAt: `2026-06-23T17:30:00${EDT}`,
    endAt: `2026-07-30T18:45:00${EDT}`,
    ageMin: 8,
    ageMax: 11,
    url: 'https://secure.rec1.com/VA/rockingham-county-va/catalog?filter=c2VhcmNoPTQzNTM3MzA=',
  },
  {
    title: 'Youth Volleyball Clinic (6th–8th Grade)',
    grade: '6th–8th grade',
    // Tue/Thu Jun 23 – Jul 30; 7:00–8:30 PM.
    startAt: `2026-06-23T19:00:00${EDT}`,
    endAt: `2026-07-30T20:30:00${EDT}`,
    ageMin: 11,
    ageMax: 14,
    url: 'https://secure.rec1.com/VA/rockingham-county-va/catalog?filter=c2VhcmNoPTQzNTM3Njk=',
  },
];

function descFor(e: ClinicEvent): string {
  const time = e.grade.startsWith('3') ? '5:30–6:45 PM' : '7:00–8:30 PM';
  return (
    `Rockingham County Parks & Recreation Youth Volleyball Clinic for ${e.grade}. ` +
    `Players learn volleyball fundamentals, improve their skills, and build ` +
    `confidence on the court in a positive, supportive environment with ` +
    `experienced coaches — all skill levels welcome. Meets Tuesdays & ` +
    `Thursdays, June 23 – July 30, 2026, ${time}, at the Rockingham Rec Center. ` +
    `Fee $65; register by June 21 (wait list once full). Questions: Kevin Jones, ` +
    `kjones@rockinghamcountyva.gov.`
  );
}

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
    console.log(`[vb-clinic] created sources row (${manual!.id})`);
  } else {
    console.log(`[vb-clinic] reusing existing "Manual entries" source (${manual.id})`);
  }

  let inserted = 0, skipped = 0;
  for (const e of EVENTS) {
    const sourceEventId = sourceEventIdFor(e.title, e.startAt);
    const result = await db.insert(activities).values({
      sourceId: manual!.id,
      sourceEventId,
      title: e.title,
      description: descFor(e),
      startAt: new Date(e.startAt),
      endAt: new Date(e.endAt),
      timezone: 'America/New_York',
      venueName: VENUE.name,
      address: VENUE.address,
      city: VENUE.city,
      region: VENUE.region,
      country: 'US',
      location: [VENUE.lng, VENUE.lat] as [number, number],
      ageMin: e.ageMin,
      ageMax: e.ageMax,
      costMinCents: 6500,
      costMaxCents: 6500,
      currency: 'USD',
      availability: 'onsale',
      isVirtual: false,
      organizerName: ORGANIZER_NAME,
      organizerUrl: ORGANIZER_URL,
      organizerKey: ORGANIZER_KEY,
      url: e.url,
      imageUrl: null,
      categories: ['sports', 'volleyball'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-rockingham-youth-volleyball-clinic-2026',
        importedAt: new Date().toISOString(),
      },
    }).onConflictDoNothing().returning({ id: activities.id });

    if (result.length > 0) {
      console.log(`  + ${e.startAt.slice(0, 16)}  ${e.title}`);
      inserted++;
    } else {
      console.log(`  = ${e.startAt.slice(0, 16)}  ${e.title}  (exists)`);
      skipped++;
    }
  }
  console.log(`[vb-clinic] done — inserted=${inserted}, skipped=${skipped}, total=${EVENTS.length}`);
  process.exit(0);
}

main().catch((e) => { console.error('[vb-clinic] failed:', e); process.exit(1); });
