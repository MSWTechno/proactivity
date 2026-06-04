/**
 * One-off ingestion for Camp Horizons (Harrisonburg, VA) — Summer 2026
 * overnight outdoor camp sessions. Source: camphorizons.com/dates-rates/
 * (captured 2026-06-04).
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-camp-horizons-2026.ts
 *
 * Idempotent (onConflictDoUpdate refreshes price/desc). Multi-day overnight
 * sessions; tagged outdoor + camps (the Outdoor camp facet). Equestrian /
 * Adventure also get sports. Venue: 3586 Horizons Way, Harrisonburg.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Camp Horizons';
const ORGANIZER_KEY = 'camp-horizons';
const ORGANIZER_URL = 'https://camphorizons.com';
const URL = 'https://camphorizons.com/dates-rates/';
const EDT = '-04:00';

const VENUE = {
  name: 'Camp Horizons',
  address: '3586 Horizons Way',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.498,
  lng: -78.952,
};

interface Session {
  program: string;
  label: string;       // session label
  startDate: string;   // YYYY-MM-DD
  endDate: string;
  ageMin: number;
  ageMax: number;
  costCents: number;
  categories: string[];
  blurb: string;
}

const SESSIONS: Session[] = [
  // Base Camp (ages 6–16)
  ...([
    ['Session 1', '2026-06-14', '2026-06-20', 210000],
    ['Session 2', '2026-06-21', '2026-07-04', 365000],
    ['Session 3', '2026-07-05', '2026-07-18', 365000],
    ['Session 4', '2026-07-19', '2026-08-01', 365000],
    ['Session 5', '2026-08-02', '2026-08-15', 365000],
  ] as [string, string, string, number][]).map(([label, s, e, c]) => ({
    program: 'Base Camp', label, startDate: s, endDate: e, ageMin: 6, ageMax: 16, costCents: c,
    categories: ['outdoor', 'camps', 'family'],
    blurb: 'Overnight outdoor camp with swimming, sports, horseback, drama, arts and adventure.',
  })),
  // Equestrian Camp (ages 9–16)
  ...([
    ['Session 1', '2026-06-14', '2026-06-20', 245000],
    ['Session 2', '2026-06-21', '2026-07-04', 400000],
    ['Session 3', '2026-07-05', '2026-07-18', 400000],
    ['Session 4', '2026-07-19', '2026-08-01', 400000],
    ['Session 5', '2026-08-02', '2026-08-15', 400000],
  ] as [string, string, string, number][]).map(([label, s, e, c]) => ({
    program: 'Equestrian Camp', label, startDate: s, endDate: e, ageMin: 9, ageMax: 16, costCents: c,
    categories: ['outdoor', 'sports', 'camps'],
    blurb: 'Overnight horseback-riding camp combining daily riding instruction with the full outdoor camp experience.',
  })),
  // Leadership Camp (rising HS seniors)
  ...([
    ['Leadership A', '2026-06-21', '2026-07-18', 275000],
    ['Leadership B', '2026-07-19', '2026-08-15', 275000],
  ] as [string, string, string, number][]).map(([label, s, e, c]) => ({
    program: 'Leadership Camp', label, startDate: s, endDate: e, ageMin: 17, ageMax: 18, costCents: c,
    categories: ['outdoor', 'education', 'camps'],
    blurb: 'Four-week leadership development program for rising high school seniors.',
  })),
  // Adventure Camp (ages 13–17)
  ...([
    ['Session 1', '2026-07-05', '2026-07-11', 197500],
    ['Session 2', '2026-07-12', '2026-07-18', 197500],
    ['Session 3', '2026-07-19', '2026-07-25', 197500],
  ] as [string, string, string, number][]).map(([label, s, e, c]) => ({
    program: 'Adventure Camp', label, startDate: s, endDate: e, ageMin: 13, ageMax: 17, costCents: c,
    categories: ['outdoor', 'sports', 'camps'],
    blurb: 'Outdoor adventure camp — backpacking, climbing, paddling and trips through the Shenandoah Valley.',
  })),
];

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function sourceEventIdFor(title: string, startAt: string): string {
  const stamp = new Date(startAt).toISOString().slice(0, 16).replace(/[T:]/g, '');
  return `manual-${slug(title).slice(0, 80)}-${stamp}`;
}
function pretty(d: string): string {
  const [y, mo, da] = d.split('-');
  const M = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${M[+mo]} ${+da}`;
}

async function main() {
  let manual = (await db.select().from(sources).where(eq(sources.adapterKey, 'manual')))[0];
  if (!manual) {
    [manual] = await db.insert(sources)
      .values({ adapterKey: 'manual', name: 'Manual entries', enabled: false, config: {} })
      .returning();
    console.log(`[horizons] created sources row (${manual!.id})`);
  } else {
    console.log(`[horizons] reusing existing "Manual entries" source (${manual.id})`);
  }

  let n = 0;
  for (const s of SESSIONS) {
    const title = `Camp Horizons: ${s.program}`;
    const startAt = `${s.startDate}T14:00:00${EDT}`;  // afternoon check-in
    const endAt = `${s.endDate}T11:00:00${EDT}`;       // morning checkout
    const description =
      `${s.blurb} ${s.label}: ${pretty(s.startDate)}–${pretty(s.endDate)}, 2026 ` +
      `(ages ${s.ageMin}–${s.ageMax}). Overnight, $${(s.costCents / 100).toLocaleString()}. ` +
      `3586 Horizons Way, Harrisonburg. Register at camphorizons.com.`;
    await db.insert(activities).values({
      sourceId: manual!.id,
      sourceEventId: sourceEventIdFor(title, startAt),
      title,
      description,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      timezone: 'America/New_York',
      venueName: VENUE.name,
      address: VENUE.address,
      city: VENUE.city,
      region: VENUE.region,
      country: 'US',
      location: [VENUE.lng, VENUE.lat] as [number, number],
      ageMin: s.ageMin,
      ageMax: s.ageMax,
      costMinCents: s.costCents,
      costMaxCents: s.costCents,
      currency: 'USD',
      availability: 'onsale',
      isVirtual: false,
      organizerName: ORGANIZER_NAME,
      organizerUrl: ORGANIZER_URL,
      organizerKey: ORGANIZER_KEY,
      url: URL,
      imageUrl: null,
      categories: s.categories,
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-camp-horizons-2026',
        session: s.label,
        importedAt: new Date().toISOString(),
      },
    }).onConflictDoUpdate({
      target: [activities.sourceId, activities.sourceEventId],
      set: { description, costMinCents: s.costCents, costMaxCents: s.costCents },
    });
    console.log(`  ~ ${s.startDate}  ${title} (${s.label})`);
    n++;
  }
  console.log(`[horizons] done — ${n} sessions`);
  process.exit(0);
}

main().catch((e) => { console.error('[horizons] failed:', e); process.exit(1); });
