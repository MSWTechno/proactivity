/**
 * One-off ingestion for the JMU "Loren LaPorte" Softball Camps — Summer 2026.
 * Dates from the official 2026 camp flyer; times / ages / venue / pricing from
 * the 2025 Ryzer registration pages (carried forward — prices may change, so
 * the description flags them as the prior-year rate). Register at
 * lorenlaportecamps.com (powered by Ryzer). Captured 2026-06-04.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-jmu-softball-camps-2026.ts
 *
 * Idempotent (onConflictDoUpdate refreshes price/desc). Venue: Bank of the
 * James Field at Veterans Memorial Park, Harrisonburg (in the radius).
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'JMU Softball (Loren LaPorte Camps)';
const ORGANIZER_KEY = 'jmu-softball-camps-2026-import';
const ORGANIZER_URL = 'https://www.lorenlaportecamps.com/';
const URL = 'https://www.lorenlaportecamps.com/';
const EDT = '-04:00';

const VENUE = {
  name: 'Bank of the James Field at Veterans Memorial Park',
  address: '230 Veterans Memorial Drive',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.4283,
  lng: -78.8712,
};

interface CampEvent {
  title: string;
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:MM (24h)
  endTime: string;
  ageMin: number;
  ageMax: number;
  costCents: number;   // all-in (base + fee), 2025 rate
  description: string;
}

const EVENTS: CampEvent[] = [
  {
    title: 'JMU Softball: Jr. Dukes All-Skills Camp',
    date: '2026-06-23', startTime: '10:00', endTime: '16:00',
    ageMin: 8, ageMax: 12, costCents: 19200,
    description:
      'JMU "Loren LaPorte" Jr. Dukes All-Skills softball camp for ages 8–12 ' +
      '(3rd–6th grade) at Bank of the James Field, Veterans Memorial Park. ' +
      'June 23, 2026, 10 AM–4 PM (check-in 9:30 AM, one-hour lunch break). ' +
      'Cost ~$192 (2025 rate: $180 + $12 fee — confirm current pricing at ' +
      'registration). Register at lorenlaportecamps.com.',
  },
  {
    title: 'JMU Softball: June Prospect Camp',
    date: '2026-06-24', startTime: '10:00', endTime: '17:00',
    ageMin: 13, ageMax: 18, costCents: 21200,
    description:
      'JMU "Loren LaPorte" June Prospect softball camp for ages 13–18 ' +
      '(8th–12th grade) — skill work and live play with personalized coaching ' +
      'from the JMU staff. June 24, 2026, 10 AM–5 PM (check-in 9:30 AM) at ' +
      'Bank of the James Field, Veterans Memorial Park. Cost ~$212 (2025 rate: ' +
      '$200 + $12 fee — confirm at registration). Register at lorenlaportecamps.com.',
  },
  {
    title: 'JMU Softball: July Prospect Camp',
    date: '2026-07-14', startTime: '10:00', endTime: '17:00',
    ageMin: 13, ageMax: 18, costCents: 21200,
    description:
      'JMU "Loren LaPorte" July Prospect softball camp for ages 13–18 ' +
      '(8th–12th grade) — skill work and live play with personalized coaching ' +
      'from the JMU staff. July 14, 2026, 10 AM–5 PM (check-in 9:30 AM) at ' +
      'Bank of the James Field, Veterans Memorial Park. Cost ~$212 (2025 rate: ' +
      '$200 + $12 fee — confirm at registration). Register at lorenlaportecamps.com.',
  },
  {
    title: 'JMU Softball: Jr. Dukes All-Skills Camp',
    date: '2026-07-15', startTime: '10:00', endTime: '16:00',
    ageMin: 8, ageMax: 12, costCents: 19200,
    description:
      'JMU "Loren LaPorte" Jr. Dukes All-Skills softball camp for ages 8–12 ' +
      '(3rd–6th grade) at Bank of the James Field, Veterans Memorial Park. ' +
      'July 15, 2026, 10 AM–4 PM (check-in 9:30 AM, one-hour lunch break). ' +
      'Cost ~$192 (2025 rate: $180 + $12 fee — confirm current pricing at ' +
      'registration). Register at lorenlaportecamps.com.',
  },
  {
    title: 'JMU Softball: August Prospect Camp',
    date: '2026-08-23', startTime: '10:00', endTime: '17:00',
    ageMin: 13, ageMax: 18, costCents: 21200,
    description:
      'JMU "Loren LaPorte" August Prospect softball camp for ages 13–18 ' +
      '(8th–12th grade) — skill work and live play with personalized coaching ' +
      'from the JMU staff. August 23, 2026, 10 AM–5 PM (check-in 9:30 AM) at ' +
      'Bank of the James Field, Veterans Memorial Park. Cost ~$212 (2025 rate: ' +
      '$200 + $12 fee — confirm at registration). Register at lorenlaportecamps.com.',
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
    console.log(`[jmu-sb] created sources row (${manual!.id})`);
  } else {
    console.log(`[jmu-sb] reusing existing "Manual entries" source (${manual.id})`);
  }

  let n = 0;
  for (const e of EVENTS) {
    const startAt = `${e.date}T${e.startTime}:00${EDT}`;
    const endAt = `${e.date}T${e.endTime}:00${EDT}`;
    const sourceEventId = sourceEventIdFor(e.title, startAt);
    await db.insert(activities).values({
      sourceId: manual!.id,
      sourceEventId,
      title: e.title,
      description: e.description,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
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
      organizerUrl: ORGANIZER_URL,
      organizerKey: ORGANIZER_KEY,
      url: URL,
      imageUrl: null,
      categories: ['sports', 'camps'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-jmu-softball-camps-2026',
        importedAt: new Date().toISOString(),
      },
    }).onConflictDoUpdate({
      target: [activities.sourceId, activities.sourceEventId],
      set: { description: e.description, costMinCents: e.costCents, costMaxCents: e.costCents },
    });
    console.log(`  ~ ${e.date}  ${e.title}`);
    n++;
  }
  console.log(`[jmu-sb] done — ${n} softball camps`);
  process.exit(0);
}

main().catch((e) => { console.error('[jmu-sb] failed:', e); process.exit(1); });
