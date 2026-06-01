/**
 * One-off ingestion: The Secret Lair (Harrisonburg game shop) tabletop events,
 * June 2026. Source: three Facebook event pages saved as MHTML (Downloads,
 * 2026-06-01).
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-secret-lair-2026.ts
 *
 * Idempotent: keys on (sourceId, sourceEventId) via the unique index.
 *
 * Notes:
 * - Venue: The Secret Lair, 1854 E Market St Suite 105, Harrisonburg, VA 22801.
 *   Coords are the plaza geocode (Nominatim); the shop is Suite 105 there.
 * - Facebook only published START times; endAt left null (not invented).
 * - Pokemon GLC had no entry fee listed → cost null. MTG is $35/person.
 * - The two MTG rows are the two distinct pre-release sessions the event
 *   description references ("two pre-releases... sign up for one"), NOT a dup.
 * - URLs are the canonical facebook.com/events/<id> per event (the most-
 *   frequent event id in each MHTML file). organizerUrl is the shop's FB
 *   events page.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const EDT = '-04:00';
const ORGANIZER_NAME = 'The Secret Lair';
const ORGANIZER_KEY = 'secret-lair-2026-import';

const VENUE = {
  name: 'The Secret Lair',
  address: '1854 E Market St Suite 105',
  city: 'Harrisonburg',
  region: 'VA',
  lat: 38.4301,
  lng: -78.8414,
};

interface Row {
  title: string;
  date: string;
  start: string; // HH:mm
  costCents: number | null;
  url: string;
  desc: string;
}

const ROWS: Row[] = [
  {
    title: 'MTG Marvel Super Heroes Pre-release (Session 1)',
    date: '2026-06-19', start: '18:00', costCents: 3500,
    url: 'https://www.facebook.com/events/1001955135856082',
    desc: "Magic: The Gathering — Marvel's Super Heroes pre-release at The Secret Lair. Entry includes a Super Heroes pre-release kit; one deck-building round then 3+ rounds of play. Entry fee $35/person. Sign up in advance at the shop or day-of (spots limited). One of two sessions — sign up for one.",
  },
  {
    title: 'MTG Marvel Super Heroes Pre-release (Session 2)',
    date: '2026-06-20', start: '17:00', costCents: 3500,
    url: 'https://www.facebook.com/events/1328972862662518',
    desc: "Magic: The Gathering — Marvel's Super Heroes pre-release at The Secret Lair. Entry includes a Super Heroes pre-release kit; one deck-building round then 3+ rounds of play. Entry fee $35/person. Sign up in advance at the shop or day-of (spots limited). One of two sessions — sign up for one.",
  },
  {
    title: 'June 2026 Pokemon Gym Leader Challenge',
    date: '2026-06-27', start: '12:00', costCents: null,
    url: 'https://www.facebook.com/events/26474193015616720',
    desc: 'Pokemon TCG Gym Leader Challenge (GLC) at The Secret Lair — expanded constructed, bring your own deck. GLC rules: single Pokemon type, no ACE SPEC, no Rule Box Pokemon (ex/V), singleton (one copy per card name).',
  },
];

interface EventRow {
  title: string;
  description: string;
  startAt: string;
  costCents: number | null;
  url: string;
}

const events: EventRow[] = ROWS.map((r): EventRow => ({
  title: r.title,
  description: r.desc,
  startAt: `${r.date}T${r.start}:00${EDT}`,
  costCents: r.costCents,
  url: r.url,
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
    console.log(`[lair] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[lair] reusing existing "Manual entries" source (${manual.id})`);
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
        endAt: null,
        timezone: 'America/New_York',
        venueName: VENUE.name,
        address: VENUE.address,
        city: VENUE.city,
        region: VENUE.region,
        country: 'US',
        location: [VENUE.lng, VENUE.lat] as [number, number],
        ageMin: null,
        ageMax: null,
        costMinCents: e.costCents,
        costMaxCents: e.costCents,
        currency: 'USD',
        availability: 'onsale',
        isVirtual: false,
        organizerName: ORGANIZER_NAME,
        organizerUrl: 'https://www.facebook.com/secretlaircomics/events',
        organizerKey: ORGANIZER_KEY,
        url: e.url,
        imageUrl: null,
        categories: ['games', 'community'],
        raw: {
          source: 'admin-manual',
          createdBy: 'script:ingest-secret-lair-2026',
          importedAt: new Date().toISOString(),
        },
      })
      .onConflictDoNothing()
      .returning({ id: activities.id });

    if (result.length > 0) {
      console.log(`  + ${e.startAt.slice(0, 16)}  ${e.title}`);
      inserted++;
    } else {
      console.log(`  = ${e.startAt.slice(0, 16)}  ${e.title}  (exists)`);
      skipped++;
    }
  }
  console.log(`[lair] done — inserted=${inserted}, skipped=${skipped}, total=${events.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[lair] failed:', e);
  process.exit(1);
});
