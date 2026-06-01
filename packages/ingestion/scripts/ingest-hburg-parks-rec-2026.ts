/**
 * One-off ingestion: Harrisonburg Parks & Recreation events, Summer/Fall 2026.
 * Source: harrisonburgva.gov individual event pages (special-events, art-in-
 * the-park, parks-month) fetched 2026-06-01.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-hburg-parks-rec-2026.ts
 *
 * Idempotent: keys on (sourceId, sourceEventId) via the unique index.
 *
 * Distinct from the Rockingham Rec Center events (different org). Coordinates
 * are real venue geocodes (Nominatim). Only events with a confirmed
 * date+time+geocodable venue are included; see SKIPPED note at bottom.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const EDT = '-04:00';
const ORGANIZER_NAME = 'Harrisonburg Parks & Recreation';
const ORGANIZER_URL = 'https://www.harrisonburgva.gov/parks-recreation';
const ORGANIZER_KEY = 'hburg-parks-rec-2026-import';

// Venue geocodes (Nominatim, 2026-06-01).
const V = {
  WESTOVER: { name: 'Westover Park', lat: 38.4492, lng: -78.8825 },
  HERITAGE: { name: 'Heritage Oaks Golf Course', lat: 38.4471, lng: -78.8992 },
  SAMPSON: { name: 'Ralph Sampson Park', lat: 38.4546, lng: -78.8553 },
  CAC: { name: 'Cecil F. Gilkerson Community Activities Center', lat: 38.4487, lng: -78.8799 },
  HILLANDALE: { name: 'Hillandale Park', lat: 38.4415, lng: -78.8964 },
  PURCELL: { name: 'Purcell Park', lat: 38.4264, lng: -78.8817 },
  MORRISON: { name: 'Morrison Park', lat: 38.4553, lng: -78.8753 },
  RIVENROCK: { name: 'Riven Rock Park', lat: 38.5161, lng: -79.0557 },
};

type Venue = { name: string; lat: number; lng: number };

interface Row {
  title: string;
  date: string;
  start: string;
  end?: string; // omit when not published
  venue: Venue;
  venueLabel?: string; // overrides display name (e.g. shelter / sub-feature)
  cost: number | null; // min cents
  costMax?: number | null;
  availability: 'free' | 'onsale' | 'dropin';
  url: string;
  categories: string[];
  desc: string;
}

const SE = 'https://www.harrisonburgva.gov';

const ROWS: Row[] = [
  // ---- Discrete special events ----
  {
    title: 'Play All Day VA',
    date: '2026-06-21', start: '06:00', end: '21:00', venue: V.WESTOVER, venueLabel: 'Westover Pool',
    cost: 0, availability: 'free', url: `${SE}/play-all-day`,
    categories: ['family', 'community', 'outdoor'],
    desc: 'Statewide celebration of parks & recreation — free programs and services, plus free admission to Westover Pool for City residents.',
  },
  {
    title: 'Celebrating the Firefly',
    date: '2026-06-23', start: '20:45', end: '22:00', venue: V.HERITAGE,
    cost: 0, availability: 'free', url: `${SE}/firefly`,
    categories: ['outdoor', 'family', 'education'],
    desc: 'Evening firefly-watching event at Heritage Oaks Golf Course. Rain date Thu Jun 25. For golf-cart transportation, reserve via 540-433-2474 / Harriet.Flynn@HarrisonburgVA.Gov.',
  },
  {
    title: 'Harrisonburg Youth TryAthlon',
    date: '2026-08-08', start: '08:30', end: '11:30', venue: V.WESTOVER,
    cost: 3000, costMax: 4000, availability: 'onsale',
    url: 'https://runsignup.com/Race/VA/Harrisonburg/HarrisonburgYouthTryAthlon',
    categories: ['sports', 'family', 'outdoor'],
    desc: 'Youth triathlon at Westover Park. $30/participant early (before Jun 30), $40 Jul 1–31; fee includes t-shirt. Register via RunSignUp.',
  },
  {
    title: 'Harrisonburg-Rockingham African American Festival',
    date: '2026-09-12', start: '12:00', end: '18:00', venue: V.SAMPSON,
    cost: 0, availability: 'free', url: `${SE}/hraaf`,
    categories: ['festivals', 'community', 'music'],
    desc: 'Annual festival celebrating African American heritage and culture at Ralph Sampson Park.',
  },

  // ---- Art in the Park — youth (no registration; drop-in) ----
  ...([
    ['Watercolor', '2026-06-10', '10:00', '11:00', V.PURCELL, 'Dream Come True Playground (Purcell Park)'],
    ['Pollinator Hotels', '2026-06-11', '14:00', '15:30', V.PURCELL, undefined],
    ['Creator Space', '2026-06-16', '13:00', '15:00', V.MORRISON, undefined],
    ['Creator Space', '2026-06-25', '13:00', '15:00', V.PURCELL, undefined],
    ['Cyanotype', '2026-06-29', '10:00', '11:00', V.PURCELL, 'Dream Come True Playground (Purcell Park)'],
    ['Creator Space', '2026-07-07', '16:30', '18:30', V.MORRISON, undefined],
    ['Creator Space', '2026-07-16', '10:00', '12:00', V.PURCELL, 'Purcell Park (Shelter 2)'],
    ['Creator Space', '2026-07-23', '16:30', '18:30', V.PURCELL, 'Purcell Park (Shelter 2)'],
    ['Mixed Media', '2026-07-28', '10:00', '11:00', V.PURCELL, 'Dream Come True Playground (Purcell Park)'],
    ['Creator Space', '2026-08-06', '16:30', '18:30', V.SAMPSON, undefined],
    ['Clay', '2026-08-12', '10:00', '11:00', V.PURCELL, 'Purcell Park (Shelter 2)'],
  ] as const).map(([proj, date, start, end, venue, label]): Row => ({
    title: `Art in the Park: ${proj} (Youth)`,
    date, start, end, venue, venueLabel: label,
    cost: 0, availability: 'free', url: `${SE}/art-in-the-park`,
    categories: ['arts', 'family'],
    desc: `Free youth art program (${proj}) — no registration needed. Part of Harrisonburg Parks & Rec's Art in the Park series.`,
  })),

  // ---- Art in the Park — adult (registration required) ----
  {
    title: 'Art in the Park: Mosaics (Adult)',
    date: '2026-06-17', start: '13:00', end: '16:00', venue: V.RIVENROCK, venueLabel: 'Riven Rock Park (Shelter 3)',
    cost: null, availability: 'onsale', url: `${SE}/art-in-the-park`,
    categories: ['arts', 'education'],
    desc: 'Adult mosaics workshop in the Art in the Park series at Riven Rock Park. Registration required via WebTrac.',
  },
  {
    title: 'Art in the Park: Ukulele (Adult)',
    date: '2026-07-01', start: '13:00', end: '16:00', venue: V.HILLANDALE,
    cost: null, availability: 'onsale', url: `${SE}/art-in-the-park`,
    categories: ['arts', 'music', 'education'],
    desc: 'Adult ukulele session in the Art in the Park series. Registration required via WebTrac.',
  },

  // ---- Parks & Recreation Month (July) — free, dated programs ----
  ...([
    ['Fitness Fusion', '2026-07-07', '17:30', '18:30', ['wellness', 'sports']],
    ['Fitness Fusion', '2026-07-14', '17:30', '18:30', ['wellness', 'sports']],
    ['Yoga', '2026-07-21', '17:30', '18:30', ['wellness']],
    ['Zumba', '2026-07-28', '17:30', '18:30', ['wellness', 'music']],
  ] as const).map(([cls, date, start, end, cats]): Row => ({
    title: `Free Fitness Class: ${cls}`,
    date, start, end, venue: V.CAC,
    cost: 0, availability: 'free', url: `${SE}/parks-month`,
    categories: cats as unknown as string[],
    desc: `Free ${cls} class (ages 15+) at the Community Activities Center for Parks & Rec Month. Registration required.`,
  })),
  {
    title: 'Tree Identification Walk',
    date: '2026-07-22', start: '13:00', end: '14:00', venue: V.HILLANDALE,
    cost: 0, availability: 'free', url: `${SE}/parks-month`,
    categories: ['outdoor', 'education', 'family'],
    desc: 'Free all-ages tree identification walk at Hillandale Park for Parks & Rec Month.',
  },
  ...([
    ['2026-07-09'], ['2026-07-23'],
  ] as const).map(([date]): Row => ({
    title: 'Story Time Under the Oak Tree',
    date, start: '10:00', venue: V.HILLANDALE, venueLabel: 'Hillandale Park (Shelter 12)',
    cost: 0, availability: 'free', url: `${SE}/parks-month`,
    categories: ['family', 'education'],
    desc: 'Free story time for ages 0–5 under the oak tree at Hillandale Park Shelter 12.',
  })),
  ...([
    '2026-07-18', '2026-07-25', '2026-08-01', '2026-08-08',
  ] as const).map((date): Row => ({
    title: 'Fishing Fridays',
    date, start: '09:00', end: '10:00', venue: V.PURCELL, venueLabel: 'Purcell Park Pond',
    cost: 0, availability: 'free', url: `${SE}/parks-month`,
    categories: ['outdoor', 'family', 'sports'],
    desc: 'Free drop-in fishing for ages 6–15 at Purcell Park Pond. Part of Parks & Rec Month.',
  })),
  ...([
    '2026-07-23', '2026-08-20',
  ] as const).map((date): Row => ({
    title: 'Wing Day Wednesday',
    date, start: '20:00', end: '21:00', venue: V.HILLANDALE, venueLabel: 'Hillandale Park (Shelter 12)',
    cost: 0, availability: 'free', url: `${SE}/parks-month`,
    categories: ['outdoor', 'family', 'education'],
    desc: 'Free evening program (elementary age+) at Hillandale Park Shelter 12. Part of Parks & Rec Month.',
  })),
];

interface EventRow {
  title: string;
  description: string;
  startAt: string;
  endAt: string | null;
  venueName: string;
  lat: number;
  lng: number;
  cost: number | null;
  costMax: number | null;
  availability: string;
  url: string;
  categories: string[];
}

const events: EventRow[] = ROWS.map((r): EventRow => ({
  title: r.title,
  description: r.desc,
  startAt: `${r.date}T${r.start}:00${EDT}`,
  endAt: r.end ? `${r.date}T${r.end}:00${EDT}` : null,
  venueName: r.venueLabel ?? r.venue.name,
  lat: r.venue.lat,
  lng: r.venue.lng,
  cost: r.cost,
  costMax: r.costMax ?? r.cost,
  availability: r.availability,
  url: r.url,
  categories: r.categories,
}));

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function sourceEventIdFor(e: EventRow): string {
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
    console.log(`[hpr] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[hpr] reusing existing "Manual entries" source (${manual.id})`);
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
        venueName: e.venueName,
        address: null,
        city: 'Harrisonburg',
        region: 'VA',
        country: 'US',
        location: [e.lng, e.lat] as [number, number],
        ageMin: null,
        ageMax: null,
        costMinCents: e.cost,
        costMaxCents: e.costMax,
        currency: 'USD',
        availability: e.availability,
        isVirtual: false,
        organizerName: ORGANIZER_NAME,
        organizerUrl: ORGANIZER_URL,
        organizerKey: ORGANIZER_KEY,
        url: e.url,
        imageUrl: null,
        categories: e.categories,
        raw: {
          source: 'admin-manual',
          createdBy: 'script:ingest-hburg-parks-rec-2026',
          importedAt: new Date().toISOString(),
        },
      })
      .onConflictDoNothing()
      .returning({ id: activities.id });

    if (result.length > 0) {
      console.log(`  + ${e.startAt.slice(0, 10)} ${e.startAt.slice(11, 16)}  ${e.title}`);
      inserted++;
    } else {
      console.log(`  = ${e.startAt.slice(0, 10)} ${e.startAt.slice(11, 16)}  ${e.title}  (exists)`);
      skipped++;
    }
  }
  console.log(`[hpr] done — inserted=${inserted}, skipped=${skipped}, total=${events.length}`);

  // SKIPPED (insufficient/ambiguous data): Holiday Parade (page still shows
  // 2025 date), Art "Pour Paint" (July, no firm date), and the vague recurring
  // free-admission promos (Simms Wed / CAC Tue "in July" — no explicit dates).
  // Parks-Month Creator Space entries were dropped in favor of the
  // Art-in-the-Park ones (conflicting locations for the same dates).
  process.exit(0);
}

main().catch((e) => {
  console.error('[hpr] failed:', e);
  process.exit(1);
});
