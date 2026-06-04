/**
 * One-off ingestion for Skyline Gymnastics (Harrisonburg, VA) "Summertime
 * Skills Clinics" 2026. Source: flyer (downloaded 2026-06-04); registration on
 * the org's Jackrabbit event calendar (orgID 552347). $15 per clinic.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-skyline-gymnastics-clinics-2026.ts
 *
 * Idempotent (onConflictDoUpdate). One row per clinic (two per date: a 10–11 AM
 * and an 11:15 AM–12:15 PM slot). Tagged sports. Venue: 325 Cornerstone Ln.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Skyline Gymnastics';
const ORGANIZER_KEY = 'skyline-gymnastics';
const ORGANIZER_URL = 'https://www.skylinegymnastics.net';
const URL = 'https://app.jackrabbitclass.com/eventcalendar.asp?orgID=552347';
const EDT = '-04:00';

const VENUE = {
  name: 'Skyline Gymnastics',
  address: '325 Cornerstone Lane',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.418,
  lng: -78.836,
};

interface Clinic {
  title: string;
  date: string;        // YYYY-MM-DD
  start: string;       // HH:MM
  end: string;
  detail: string;
  ageMin: number | null;
  ageMax: number | null;
}

const AM = { start: '10:00', end: '11:00' };
const MID = { start: '11:15', end: '12:15' };

const CLINICS: Clinic[] = [
  { title: 'Cartwheels & Roundoffs', date: '2026-06-09', ...AM, detail: 'cartwheels and roundoffs', ageMin: null, ageMax: null },
  { title: 'Middle School Cheer',   date: '2026-06-09', ...MID, detail: 'middle school cheer', ageMin: 11, ageMax: 14 },
  { title: 'Walkovers',             date: '2026-06-16', ...AM, detail: 'walkovers', ageMin: null, ageMax: null },
  { title: 'Middle School Cheer',   date: '2026-06-16', ...MID, detail: 'middle school cheer', ageMin: 11, ageMax: 14 },
  { title: 'Handsprings',           date: '2026-06-23', ...AM, detail: 'handsprings', ageMin: null, ageMax: null },
  { title: 'Middle School Cheer',   date: '2026-06-23', ...MID, detail: 'middle school cheer', ageMin: 11, ageMax: 14 },
  { title: 'Advanced Floor',        date: '2026-07-07', ...AM, detail: 'advanced floor — roundoff back handsprings (ROBHS) and saltos', ageMin: null, ageMax: null },
  { title: 'Middle School Cheer',   date: '2026-07-07', ...MID, detail: 'middle school cheer', ageMin: 11, ageMax: 14 },
  { title: 'Beginner Beam',         date: '2026-07-14', ...AM, detail: 'beginner beam — rolls and cartwheels', ageMin: null, ageMax: null },
  { title: 'Advanced Beam',         date: '2026-07-14', ...MID, detail: 'advanced beam — walkovers, handsprings, aerials and saltos', ageMin: null, ageMax: null },
  { title: 'Beginner Bars',         date: '2026-07-21', ...AM, detail: 'beginner bars — pullovers and back hip circles', ageMin: null, ageMax: null },
  { title: 'Advanced Bars',         date: '2026-07-21', ...MID, detail: 'advanced bars — free hips, kips, handstands and dismounts', ageMin: null, ageMax: null },
  { title: 'Beginner Vault',        date: '2026-07-28', ...AM, detail: 'beginner vault — handsprings and half-ons', ageMin: null, ageMax: null },
  { title: 'Advanced Vault',        date: '2026-07-28', ...MID, detail: 'advanced vault — twisting and flipping', ageMin: null, ageMax: null },
];

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function sourceEventIdFor(title: string, startAt: string): string {
  const stamp = new Date(startAt).toISOString().slice(0, 16).replace(/[T:]/g, '');
  return `manual-${slug(title).slice(0, 80)}-${stamp}`;
}
function label(t: string): string {
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM'; let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

async function main() {
  let manual = (await db.select().from(sources).where(eq(sources.adapterKey, 'manual')))[0];
  if (!manual) {
    [manual] = await db.insert(sources)
      .values({ adapterKey: 'manual', name: 'Manual entries', enabled: false, config: {} })
      .returning();
    console.log(`[skyline] created sources row (${manual!.id})`);
  } else {
    console.log(`[skyline] reusing existing "Manual entries" source (${manual.id})`);
  }

  let n = 0;
  for (const c of CLINICS) {
    const title = `Skyline Gymnastics Clinic: ${c.title}`;
    const startAt = `${c.date}T${c.start}:00${EDT}`;
    const endAt = `${c.date}T${c.end}:00${EDT}`;
    const description =
      `Skyline Gymnastics summertime skills clinic — ${c.detail}. ` +
      `${label(c.start)}–${label(c.end)}. $15 per clinic (spots are limited). ` +
      `325 Cornerstone Lane, Harrisonburg. Register on the Skyline Gymnastics ` +
      `event calendar.`;
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
      ageMin: c.ageMin,
      ageMax: c.ageMax,
      costMinCents: 1500,
      costMaxCents: 1500,
      currency: 'USD',
      availability: 'onsale',
      isVirtual: false,
      organizerName: ORGANIZER_NAME,
      organizerUrl: ORGANIZER_URL,
      organizerKey: ORGANIZER_KEY,
      url: URL,
      imageUrl: null,
      categories: ['sports'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-skyline-gymnastics-clinics-2026',
        importedAt: new Date().toISOString(),
      },
    }).onConflictDoUpdate({
      target: [activities.sourceId, activities.sourceEventId],
      set: { description, costMinCents: 1500, costMaxCents: 1500 },
    });
    console.log(`  ~ ${c.date}  ${label(c.start)}  ${title}`);
    n++;
  }
  console.log(`[skyline] done — ${n} clinics`);
  process.exit(0);
}

main().catch((e) => { console.error('[skyline] failed:', e); process.exit(1); });
