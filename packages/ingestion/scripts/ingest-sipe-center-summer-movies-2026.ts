/**
 * One-off ingestion for the Sipe Center "Summer Movie Series" 2026 — free
 * kids' movies in Bridgewater, VA. Source:
 * sipecenter.com/.../summer_movie_series.php (2026-06-04).
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-sipe-center-summer-movies-2026.ts
 *
 * Idempotent. One event per movie/day; showtimes listed in the description.
 * Free admission. Venue: Sipe Center, Bridgewater (in the Harrisonburg radius).
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Sipe Center';
const ORGANIZER_KEY = 'sipe-center-summer-movies-2026-import';
const URL = 'https://www.sipecenter.com/upcoming_movies_shows/special_events/summer_movie_series.php';
const ORGANIZER_URL = 'https://www.sipecenter.com';

const VENUE = {
  name: 'Sipe Center',
  address: '100 North Main Street',
  city: 'Bridgewater',
  region: 'VA',
  lat: 38.379,
  lng: -78.978,
};

const EDT = '-04:00';
const STD = '10:30 AM, 12:30 PM, 1:30 PM, 3:30 PM';

interface Movie {
  date: string; // YYYY-MM-DD
  movie: string;
  showtimes: string;
  endTime: string; // last showtime + ~90 min
}

const MOVIES: Movie[] = [
  { date: '2026-06-10', movie: "Gabby's Dollhouse: The Movie", showtimes: '10:30 AM, 1:30 PM', endTime: '15:00' },
  { date: '2026-06-11', movie: 'Space Jam', showtimes: STD, endTime: '17:00' },
  { date: '2026-06-17', movie: 'KPop Demon Hunters Sing-Along', showtimes: STD, endTime: '17:00' },
  { date: '2026-06-18', movie: 'Beethoven', showtimes: STD, endTime: '17:00' },
  { date: '2026-06-24', movie: 'The Garfield Movie (2024)', showtimes: STD, endTime: '17:00' },
  { date: '2026-06-25', movie: 'Dolittle', showtimes: STD, endTime: '17:00' },
  { date: '2026-07-01', movie: 'The Angry Birds Movie', showtimes: STD, endTime: '17:00' },
  { date: '2026-07-02', movie: 'The Flintstones', showtimes: STD, endTime: '17:00' },
  { date: '2026-07-08', movie: 'The Angry Birds Movie 2', showtimes: STD, endTime: '17:00' },
  { date: '2026-07-09', movie: 'The Little Rascals', showtimes: STD, endTime: '17:00' },
  { date: '2026-07-15', movie: 'Hotel Transylvania', showtimes: STD, endTime: '17:00' },
  { date: '2026-07-16', movie: 'The Great Muppet Caper', showtimes: STD, endTime: '17:00' },
  { date: '2026-07-22', movie: 'Cloudy with a Chance of Meatballs', showtimes: STD, endTime: '17:00' },
  { date: '2026-07-23', movie: 'How to Train Your Dragon (2025)', showtimes: STD, endTime: '17:00' },
  { date: '2026-07-29', movie: 'Cloudy with a Chance of Meatballs 2', showtimes: STD, endTime: '17:00' },
  { date: '2026-07-30', movie: 'Babe', showtimes: STD, endTime: '17:00' },
  { date: '2026-08-05', movie: 'The LEGO Batman Movie', showtimes: STD, endTime: '17:00' },
  { date: '2026-08-06', movie: 'Nanny McPhee', showtimes: STD, endTime: '17:00' },
  { date: '2026-08-12', movie: 'The Muppet Movie (1979)', showtimes: STD, endTime: '17:00' },
  { date: '2026-08-13', movie: 'Hop', showtimes: STD, endTime: '17:00' },
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
    console.log(`[sipe] created sources row (${manual!.id})`);
  } else {
    console.log(`[sipe] reusing existing "Manual entries" source (${manual.id})`);
  }

  let inserted = 0, skipped = 0;
  for (const m of MOVIES) {
    const title = `Summer Movie: ${m.movie}`;
    const startAt = `${m.date}T10:30:00${EDT}`;
    const endAt = `${m.date}T${m.endTime}:00${EDT}`;
    const description =
      `Free kids' movie at the Sipe Center as part of its Summer Movie Series: ` +
      `${m.movie}. Showtimes: ${m.showtimes}. Free admission. 100 North Main ` +
      `Street, Bridgewater.`;
    const result = await db.insert(activities).values({
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
      ageMin: null,
      ageMax: null,
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
      categories: ['family', 'arts'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-sipe-center-summer-movies-2026',
        importedAt: new Date().toISOString(),
      },
    }).onConflictDoNothing().returning({ id: activities.id });
    if (result.length > 0) { console.log(`  + ${m.date}  ${title}`); inserted++; }
    else { console.log(`  = ${m.date}  ${title}  (exists)`); skipped++; }
  }
  console.log(`[sipe] done — inserted=${inserted}, skipped=${skipped}, total=${MOVIES.length}`);
  process.exit(0);
}

main().catch((e) => { console.error('[sipe] failed:', e); process.exit(1); });
