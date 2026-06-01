/**
 * One-off ingestion: Virginia women's college-basketball prospect camps, 2026.
 * Source: public Google Sheet compiled by Barry Flood (national list);
 * filtered to VA-location rows only.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-va-wbb-camps-2026.ts
 *
 * Idempotent: keys on (sourceId, sourceEventId) via the unique index.
 *
 * Notes:
 * - VA rows only (per request). Most are far outside the Harrisonburg feed
 *   radius — they geolocate to their host city and only surface for searches
 *   near that city or with a widened radius.
 * - Coordinates are real city-center geocodes (Nominatim), not the exact gym.
 * - Cost from the sheet; one row (Richmond) had no cost → left null.
 * - Four Virginia State rows list only a phone number; modeled with a tel:
 *   registration URL (what the sheet provides) so they still satisfy the feed.
 * - The one past-dated row (Marymount 5/30) is omitted.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const EDT = '-04:00';
const ORGANIZER_KEY = 'va-wbb-camps-2026-import';

// City-center coords (Nominatim, 2026-06-01).
const CITY: Record<string, { lat: number; lng: number }> = {
  'Lexington': { lat: 37.784, lng: -79.4428 },
  'Danville': { lat: 36.588, lng: -79.3917 },
  'Farmville': { lat: 37.3025, lng: -78.3924 },
  'Emory': { lat: 36.7834, lng: -81.8258 },
  'Lynchburg': { lat: 37.4138, lng: -79.1422 },
  'Newport News': { lat: 36.9775, lng: -76.4298 },
  'Petersburg': { lat: 37.2279, lng: -77.4019 },
  'Radford': { lat: 37.1343, lng: -80.5749 },
  'Richmond': { lat: 37.5385, lng: -77.4343 },
  'Bridgewater': { lat: 38.3821, lng: -78.9767 },
  'Ashland': { lat: 37.7594, lng: -77.4807 },
  'Harrisonburg': { lat: 38.4493, lng: -78.8689 },
  'Winchester': { lat: 39.1852, lng: -78.1652 },
  'Wise': { lat: 37.0171, lng: -82.6104 },
  'Virginia Beach': { lat: 36.8497, lng: -75.9761 },
  'Arlington': { lat: 38.8769, lng: -77.0893 },
};

// Registration URLs (verbatim from the sheet).
const U = {
  WANDL: 'https://generalsbasketballcamps.com/content/2026-generals-prospect-camp',
  AVERETT: 'https://averettwomensbasketball.totalcamps.com/shop/EVENT',
  LONGWOOD: 'https://longwoodwomensbasketball.totalcamps.com/shop/EVENT',
  EMORYHENRY: 'https://emoryandhenrywomensbasketballcamps.totalcamps.com/shop/EVENT',
  LIBERTY:
    'https://campscui.active.com/orgs/FlamesWomensBasketballCamps?orglink=camps-registration&e4q=a75dc25c-68b9-4447-ba32-8caf78a2a6df&e4p=405926e9-9c9a-4c27-a9f8-c09a379e02d7&e4ts=1777986093&e4c=active&e4e=snlvcmpscui00001load&e4rt=Safetynet&e4h=799d3c9d133c7cedf5748502f75fcfeb#/selectSessions/3748134',
  CNU: 'https://register.ryzer.com/camp.cfm?sport=4&id=314689',
  RADFORD: 'https://mikemcguirebasketball.totalcamps.com/shop/EVENT',
  RICHMOND: 'https://richmondspiderswomensbasketballcamps.totalcamps.com/About%20Us',
  BRIDGEWATER: 'https://www.eagleswbbcamps.com/prospect-camp.cfm',
  RANDOLPHMACON: 'https://register.ryzer.com/camp.cfm?sport=4&id=320574',
  JMU: 'https://portal.campnetwork.com/Register/Register.php?camp_id=397074',
  SHENANDOAH: 'https://register.ryzer.com/camp.cfm?sport=4&id=316489',
  UVAWISE: 'https://uvawisewomensbasketball.totalcamps.com/shop/EVENT',
  VAWESLEYAN: 'https://register.ryzer.com/camp.cfm?sport=4&id=330748',
  MARYMOUNT: 'https://register.ryzer.com/camp.cfm?sport=4&id=326818',
  RANDOLPHCOLLEGE:
    'https://www.randolphgirlsbasketballcamps.com/randolph-college-girls-basketball-elite-prospect-camps.cfm',
  VSU_TEL: 'tel:+18045245784', // "Coach Howard (804) 524-5784" — sheet's only contact.
};

interface Row {
  school: string;
  division: string;
  city: keyof typeof CITY;
  date: string; // start date YYYY-MM-DD
  endDate?: string; // for multi-day
  start: string; // HH:mm
  end: string;
  costCents: number | null;
  url: string;
}

const ROWS: Row[] = [
  { school: 'Washington & Lee', division: 'D3', city: 'Lexington', date: '2026-06-05', start: '10:00', end: '16:00', costCents: 17500, url: U.WANDL },
  { school: 'Washington & Lee', division: 'D3', city: 'Lexington', date: '2026-06-06', start: '10:00', end: '16:00', costCents: 17500, url: U.WANDL },
  { school: 'Averett University', division: 'D3', city: 'Danville', date: '2026-06-10', start: '13:00', end: '16:00', costCents: 7000, url: U.AVERETT },
  { school: 'Longwood University', division: 'D1', city: 'Farmville', date: '2026-06-13', start: '09:00', end: '14:00', costCents: 11000, url: U.LONGWOOD },
  { school: 'Emory & Henry', division: 'D2', city: 'Emory', date: '2026-06-14', start: '13:00', end: '17:00', costCents: 8000, url: U.EMORYHENRY },
  { school: 'Longwood University', division: 'D1', city: 'Farmville', date: '2026-06-14', start: '09:00', end: '14:00', costCents: 11000, url: U.LONGWOOD },
  { school: 'Liberty University', division: 'D1', city: 'Lynchburg', date: '2026-06-22', endDate: '2026-06-25', start: '09:00', end: '21:00', costCents: 45000, url: U.LIBERTY },
  { school: 'Averett University', division: 'D3', city: 'Danville', date: '2026-06-24', start: '13:00', end: '16:00', costCents: 7000, url: U.AVERETT },
  { school: 'Christopher Newport University', division: 'D3', city: 'Newport News', date: '2026-06-26', start: '14:00', end: '21:00', costCents: 7500, url: U.CNU },
  { school: 'Virginia State University', division: 'D2', city: 'Petersburg', date: '2026-06-27', start: '12:00', end: '16:30', costCents: 8500, url: U.VSU_TEL },
  { school: 'Christopher Newport University', division: 'D3', city: 'Newport News', date: '2026-06-27', start: '09:00', end: '17:00', costCents: 7500, url: U.CNU },
  { school: 'Radford University', division: 'D1', city: 'Radford', date: '2026-06-27', start: '13:00', end: '17:00', costCents: 8000, url: U.RADFORD },
  { school: 'University of Richmond', division: 'D1', city: 'Richmond', date: '2026-06-27', start: '13:00', end: '17:00', costCents: null, url: U.RICHMOND },
  { school: 'Radford University', division: 'D1', city: 'Radford', date: '2026-06-28', start: '13:00', end: '17:00', costCents: 8000, url: U.RADFORD },
  { school: 'Bridgewater College', division: 'D3', city: 'Bridgewater', date: '2026-06-28', start: '11:00', end: '15:00', costCents: 9000, url: U.BRIDGEWATER },
  { school: 'Randolph-Macon College', division: 'D3', city: 'Ashland', date: '2026-07-19', start: '13:00', end: '17:00', costCents: 8000, url: U.RANDOLPHMACON },
  { school: 'James Madison University', division: 'D1', city: 'Harrisonburg', date: '2026-08-01', start: '13:00', end: '17:00', costCents: 7500, url: U.JMU },
  { school: 'James Madison University', division: 'D1', city: 'Harrisonburg', date: '2026-08-02', start: '13:00', end: '17:00', costCents: 7500, url: U.JMU },
  { school: 'Shenandoah University', division: 'D3', city: 'Winchester', date: '2026-08-02', start: '11:00', end: '14:00', costCents: 7000, url: U.SHENANDOAH },
  { school: 'UVA Wise', division: 'D2', city: 'Wise', date: '2026-08-02', start: '13:00', end: '17:00', costCents: 8500, url: U.UVAWISE },
  { school: 'Washington & Lee', division: 'D3', city: 'Lexington', date: '2026-08-07', start: '10:00', end: '16:00', costCents: 17500, url: U.WANDL },
  { school: 'Washington & Lee', division: 'D3', city: 'Lexington', date: '2026-08-08', start: '10:00', end: '16:00', costCents: 17500, url: U.WANDL },
  { school: 'Virginia Wesleyan University', division: 'D3', city: 'Virginia Beach', date: '2026-08-09', start: '10:00', end: '14:00', costCents: 9500, url: U.VAWESLEYAN },
  { school: 'Virginia State University', division: 'D2', city: 'Petersburg', date: '2026-08-15', start: '12:00', end: '16:30', costCents: 8500, url: U.VSU_TEL },
  { school: 'Virginia State University', division: 'D2', city: 'Petersburg', date: '2026-08-16', start: '12:00', end: '16:30', costCents: 8500, url: U.VSU_TEL },
  { school: 'Emory & Henry', division: 'D2', city: 'Emory', date: '2026-08-16', start: '13:00', end: '17:00', costCents: 8000, url: U.EMORYHENRY },
  { school: 'Marymount University', division: 'D3', city: 'Arlington', date: '2026-09-13', start: '12:00', end: '16:00', costCents: 7000, url: U.MARYMOUNT },
  { school: 'Randolph College', division: 'D3', city: 'Lynchburg', date: '2026-09-14', start: '10:00', end: '15:00', costCents: 10000, url: U.RANDOLPHCOLLEGE },
  { school: 'UVA Wise', division: 'D2', city: 'Wise', date: '2026-09-27', start: '13:00', end: '17:00', costCents: 8500, url: U.UVAWISE },
];

interface EventRow {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  venueCity: keyof typeof CITY;
  costCents: number | null;
  url: string;
  organizer: string;
}

const events: EventRow[] = ROWS.map((r): EventRow => {
  const costText = r.costCents != null ? `$${(r.costCents / 100).toFixed(0)}` : 'see registration';
  return {
    title: `${r.school} Women's Basketball Prospect Camp`,
    description:
      `${r.division} women's basketball prospect/elite camp at ${r.school} ` +
      `(${r.city}, VA). Registration required — ${costText}. ` +
      `From a 2026 college-camp list compiled by Barry Flood.`,
    startAt: `${r.date}T${r.start}:00${EDT}`,
    endAt: `${r.endDate ?? r.date}T${r.end}:00${EDT}`,
    venueCity: r.city,
    costCents: r.costCents,
    url: r.url,
    organizer: r.school,
  };
});

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
    console.log(`[vawbb] created sources row for "Manual entries" (${manual!.id})`);
  } else {
    console.log(`[vawbb] reusing existing "Manual entries" source (${manual.id})`);
  }

  let inserted = 0;
  let skipped = 0;

  for (const e of events) {
    const c = CITY[e.venueCity];
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
        venueName: e.organizer,
        address: null,
        city: e.venueCity,
        region: 'VA',
        country: 'US',
        location: [c.lng, c.lat] as [number, number],
        ageMin: null,
        ageMax: null,
        costMinCents: e.costCents,
        costMaxCents: e.costCents,
        currency: 'USD',
        availability: 'onsale',
        isVirtual: false,
        organizerName: e.organizer,
        organizerUrl: e.url,
        organizerKey: ORGANIZER_KEY,
        url: e.url,
        imageUrl: null,
        categories: ['sports'],
        raw: {
          source: 'admin-manual',
          createdBy: 'script:ingest-va-wbb-camps-2026',
          importedAt: new Date().toISOString(),
        },
      })
      .onConflictDoNothing()
      .returning({ id: activities.id });

    if (result.length > 0) {
      console.log(`  + ${e.startAt.slice(0, 10)}  ${e.venueCity.padEnd(14)}  ${e.organizer}`);
      inserted++;
    } else {
      console.log(`  = ${e.startAt.slice(0, 10)}  ${e.venueCity.padEnd(14)}  ${e.organizer}  (exists)`);
      skipped++;
    }
  }

  console.log(`[vawbb] done — inserted=${inserted}, skipped=${skipped}, total=${events.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[vawbb] failed:', e);
  process.exit(1);
});
