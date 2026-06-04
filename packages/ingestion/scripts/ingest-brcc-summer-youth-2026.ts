/**
 * One-off ingestion for Blue Ridge Community College (BRCC) Workforce
 * Development — Summer Youth Classes 2026. Source:
 * brcc.edu/workforce-development/summer-youth-classes-2026/ (2026-06-04).
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-brcc-summer-youth-2026.ts
 *
 * Idempotent (onConflictDoUpdate so re-runs refresh price/desc). One row per
 * class, anchored at its clean July session; all session dates/times/age splits
 * are listed in the description. Register via AuguSoft (brcc.augusoft.net).
 * Venue: BRCC main campus, Weyers Cave (in the Harrisonburg radius).
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Blue Ridge Community College';
const ORGANIZER_KEY = 'brcc-summer-youth-2026-import';
const URL = 'https://www.brcc.edu/workforce-development/summer-youth-classes-2026/';

const VENUE = {
  name: 'Blue Ridge Community College',
  address: 'One College Lane',
  city: 'Weyers Cave',
  region: 'VA',
  lat: 38.290,
  lng: -78.905,
};

const EDT = '-04:00';

interface ClassEvent {
  title: string;
  startAt: string;
  endAt: string;
  ageMin: number;
  ageMax: number;
  costCents: number;
  categories: string[];
  description: string;
}

const EVENTS: ClassEvent[] = [
  {
    title: 'Ceramics: Pottery Freestyle (Youth)',
    startAt: `2026-07-06T09:00:00${EDT}`,
    endAt: `2026-07-10T12:00:00${EDT}`,
    ageMin: 12,
    ageMax: 18,
    costCents: 17500,
    categories: ['arts', 'education', 'camps'],
    description:
      'Blue Ridge Community College summer youth ceramics class (ages 12–18), ' +
      '$175. Sessions: June 1–29 Mondays 4–7 PM · July 6–10 Mon–Fri 9 AM–12 PM ' +
      '· July 13–Aug 10 Mondays 4–7 PM (main campus). Register via AuguSoft ' +
      '(brcc.augusoft.net).',
  },
  {
    title: 'Drone Zone Camp (Youth)',
    startAt: `2026-07-06T09:00:00${EDT}`,
    endAt: `2026-07-09T16:00:00${EDT}`,
    ageMin: 10,
    ageMax: 16,
    costCents: 29500,
    categories: ['education', 'camps'],
    description:
      'Blue Ridge Community College Drone Zone Camp (ages 10–16), $295, July ' +
      '6–9 at the main campus. Two sections: ages 10–13 (9 AM–12 PM) and ages ' +
      '14–16 (1–4 PM). Includes a tour of the Aviation Maintenance Technology ' +
      'facility at Shenandoah Valley Regional Airport, and students keep their ' +
      'drone. Register via AuguSoft (brcc.augusoft.net).',
  },
  {
    title: 'Pre-Veterinary Technology Camp (Youth)',
    startAt: `2026-07-06T09:00:00${EDT}`,
    endAt: `2026-07-10T16:00:00${EDT}`,
    ageMin: 14,
    ageMax: 18,
    costCents: 24500,
    categories: ['education', 'camps'],
    description:
      'Blue Ridge Community College Pre-Veterinary Technology camp (ages ' +
      '14–18), $245, July 6–10 at the main campus. Two sections: 9 AM–12 PM and ' +
      '1–4 PM. Register via AuguSoft (brcc.augusoft.net).',
  },
];

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
    console.log(`[brcc] created sources row (${manual!.id})`);
  } else {
    console.log(`[brcc] reusing existing "Manual entries" source (${manual.id})`);
  }

  let n = 0;
  for (const e of EVENTS) {
    const sourceEventId = sourceEventIdFor(e.title, e.startAt);
    await db.insert(activities).values({
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
      ageMin: e.ageMin,
      ageMax: e.ageMax,
      costMinCents: e.costCents,
      costMaxCents: e.costCents,
      currency: 'USD',
      availability: 'onsale',
      isVirtual: false,
      organizerName: ORGANIZER_NAME,
      organizerUrl: 'https://www.brcc.edu',
      organizerKey: ORGANIZER_KEY,
      url: URL,
      imageUrl: null,
      categories: e.categories,
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-brcc-summer-youth-2026',
        importedAt: new Date().toISOString(),
      },
    }).onConflictDoUpdate({
      target: [activities.sourceId, activities.sourceEventId],
      set: { description: e.description, costMinCents: e.costCents, costMaxCents: e.costCents },
    });
    console.log(`  ~ ${e.startAt.slice(0, 10)}  ${e.title}`);
    n++;
  }
  console.log(`[brcc] done — ${n} classes`);
  process.exit(0);
}

main().catch((e) => { console.error('[brcc] failed:', e); process.exit(1); });
