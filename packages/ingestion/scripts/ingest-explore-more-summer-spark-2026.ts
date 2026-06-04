/**
 * Ingestion for Explore More Discovery Museum's free weekly "Summer Spark"
 * drop-in programs (Harrisonburg, VA). Source:
 * iexploremore.com/weeklysummer2026 (captured 2026-06-04).
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-explore-more-summer-spark-2026.ts
 *
 * The page lists weekly recurring programs ("Programs Start on June 2!",
 * "all summer long") but no end date — so we generate one occurrence per
 * program per week from the first session through 2026-08-31 (END is an
 * assumption; re-verify the museum's end-of-summer date). Free with paid
 * admission/membership, no registration. Idempotent (onConflictDoNothing).
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Explore More Discovery Museum';
const ORGANIZER_KEY = 'explore-more-discovery-museum';
const ORGANIZER_URL = 'https://www.iexploremore.com';
const URL = 'https://www.iexploremore.com/weeklysummer2026';
const EDT = '-04:00';
const END = '2026-08-31';

const VENUE = {
  name: 'Explore More Discovery Museum',
  address: '150 South Main Street',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.4489,
  lng: -78.8694,
};

interface Program {
  title: string;
  firstDate: string;   // YYYY-MM-DD of the first weekly occurrence
  times: string[];     // HH:MM (24h) drop-in session start times
  ageMin: number | null;
  ageMax: number | null;
  categories: string[];
  blurb: string;
}

const PROGRAMS: Program[] = [
  {
    title: 'Tinker Time at Explore More',
    firstDate: '2026-06-02', times: ['10:30', '14:00'],
    ageMin: null, ageMax: null, categories: ['family', 'education'],
    blurb: 'Explore and create with a variety of tools and materials, from recyclable materials to wood working.',
  },
  {
    title: 'Making Masterpieces at Explore More',
    firstDate: '2026-06-03', times: ['10:30', '14:00'],
    ageMin: null, ageMax: null, categories: ['family', 'arts'],
    blurb: 'Aspiring artists create their own masterpiece and hone their creative skills exploring the techniques of famous artists.',
  },
  {
    title: 'Science Explorers at Explore More',
    firstDate: '2026-06-04', times: ['10:30', '14:00'],
    ageMin: null, ageMax: null, categories: ['family', 'education'],
    blurb: 'Grab a lab coat and safety glasses — integrate all STEM disciplines and tackle a different experiment/design challenge each week.',
  },
  {
    title: "Preschool Paint n' Play at Explore More",
    firstDate: '2026-06-05', times: ['10:30'],
    ageMin: 2, ageMax: 5, categories: ['family', 'arts'],
    blurb: 'Preschoolers and caregivers explore ways to play with paint and create their own works of art.',
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
// Step a YYYY-MM-DD forward by N days using noon-UTC to dodge DST date rollover.
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function hhmmLabel(t: string): string {
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM'; let hh = h % 12; if (hh === 0) hh = 12;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`;
}

async function main() {
  let manual = (await db.select().from(sources).where(eq(sources.adapterKey, 'manual')))[0];
  if (!manual) {
    [manual] = await db.insert(sources)
      .values({ adapterKey: 'manual', name: 'Manual entries', enabled: false, config: {} })
      .returning();
    console.log(`[explore-more] created sources row (${manual!.id})`);
  } else {
    console.log(`[explore-more] reusing existing "Manual entries" source (${manual.id})`);
  }

  let inserted = 0, skipped = 0;
  for (const p of PROGRAMS) {
    const timesLabel = p.times.map(hhmmLabel).join(' & ');
    const description =
      `${p.blurb} Part of Explore More Discovery Museum's free weekly "Summer Spark" ` +
      `programs — FREE with paid admission or membership, no registration needed. ` +
      `Weekly drop-in session${p.times.length > 1 ? `s today at ${timesLabel}` : ` at ${timesLabel}`}. ` +
      `Runs weekly through summer (end date approximate). 150 South Main Street, Harrisonburg.`;

    for (let date = p.firstDate; date <= END; date = addDays(date, 7)) {
      for (const t of p.times) {
        const startAt = `${date}T${t}:00${EDT}`;
        // ~1 hour session
        const [h, m] = t.split(':').map(Number);
        const endH = h + 1;
        const endAt = `${date}T${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${EDT}`;
        const sourceEventId = sourceEventIdFor(p.title, startAt);
        const result = await db.insert(activities).values({
          sourceId: manual!.id,
          sourceEventId,
          title: p.title,
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
          ageMin: p.ageMin,
          ageMax: p.ageMax,
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
          categories: p.categories,
          raw: {
            source: 'admin-manual',
            createdBy: 'script:ingest-explore-more-summer-spark-2026',
            importedAt: new Date().toISOString(),
          },
        }).onConflictDoNothing().returning({ id: activities.id });
        if (result.length > 0) inserted++; else skipped++;
      }
    }
    console.log(`  ~ ${p.title} — weekly ${p.firstDate}..${END} @ ${timesLabel}`);
  }
  console.log(`[explore-more] done — inserted=${inserted}, skipped=${skipped} (already present)`);
  process.exit(0);
}

main().catch((e) => { console.error('[explore-more] failed:', e); process.exit(1); });
