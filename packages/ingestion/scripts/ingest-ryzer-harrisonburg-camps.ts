/**
 * Ingestion for sports camps near Harrisonburg discovered via Ryzer's public
 * event search (the registration platform behind lorenlaportecamps.com and many
 * college camps). Calls Ryzer's `event/eventSearch` REST endpoint live for ZIP
 * 22801 within a 50-mile radius, so re-running refreshes the set.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-ryzer-harrisonburg-camps.ts
 *
 * Idempotent: keyed on Ryzer's stable event GUID (sourceEventId = ryzer-<id>),
 * onConflictDoUpdate refreshes price/dates/desc. Skips past + registration-over
 * events and the JMU Softball camps (already ingested with richer detail via
 * ingest-jmu-softball-camps-2026.ts).
 *
 * NOTE: the list endpoint gives city/dates/cost/ages but no street address or
 * start time — venue is the host institution, coords are city-level, and start
 * time defaults to 9 AM (exact time is on the registration link). If the search
 * stops returning data, re-grab the `cfsession` token from ryzer.com/events
 * (getToken()) — though as of 2026-06 the search works without auth.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import https from 'node:https';

const SEARCH_ZIP = '22801';
const SEARCH_RADIUS = '50';
const SKIP_ORGANIZERS = new Set(['James Madison Univ. - Softball Camps']);

// City-level coordinates for the Shenandoah Valley / Harrisonburg radius.
const CITY_COORDS: Record<string, [number, number]> = {
  harrisonburg: [-78.8689, 38.4496],
  bridgewater: [-78.978, 38.379],
  dayton: [-78.939, 38.414],
  'mount crawford': [-78.943, 38.349],
  'weyers cave': [-78.905, 38.290],
  broadway: [-78.799, 38.611],
  elkton: [-78.623, 38.408],
  grottoes: [-78.823, 38.267],
  staunton: [-79.072, 38.149],
  waynesboro: [-78.889, 38.068],
  charlottesville: [-78.476, 38.029],
  winchester: [-78.163, 39.186],
  lexington: [-79.443, 37.784],
};
const FALLBACK_COORD = CITY_COORDS.harrisonburg;

interface RyzerEvent {
  id: string; name: string; city: string; state: string; zip: number;
  daterange: string; startdate: string; enddate: string; cost: string;
  agerange: string; graderange: string; activitytype: string; eventtype: string;
  organizer: string; rlink: string; logo: string;
  registrationOver: number; soldOut: number;
}

function ryzerSearch(zip: string, radius: string): Promise<RyzerEvent[]> {
  const params = { Page: 0, RecordsPerPage: 300, SoldOut: 0, ZipCode: zip, Proximity: radius, SortOrder: 'Distance' };
  // The site double-encodes the body (JSON.stringify of an already-stringified
  // object), so replicate that exactly.
  const body = JSON.stringify(JSON.stringify(params));
  return new Promise((resolve, reject) => {
    const req = https.request('https://ryzer.com/rest/controller/connect/event/eventSearch/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://ryzer.com',
        'Referer': 'https://ryzer.com/events/',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        try {
          const outer = JSON.parse(d);
          if (!outer.success) return reject(new Error('Ryzer search not successful'));
          const inner = JSON.parse(outer.data);
          resolve(inner.events || []);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function toIsoDate(mdy: string): string | null {
  const m = mdy.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}
function parseCostCents(cost: string): { min: number; max: number } {
  const nums = (cost.match(/\d+(\.\d+)?/g) || []).map((n) => Math.round(parseFloat(n) * 100));
  if (!nums.length) return { min: 0, max: 0 };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}
function parseRange(s: string): { lo: number | null; hi: number | null } {
  const nums = (s.match(/\d+/g) || []).map(Number);
  if (!nums.length) return { lo: null, hi: null };
  return { lo: nums[0], hi: nums.length > 1 ? nums[1] : nums[0] };
}

async function main() {
  let manual = (await db.select().from(sources).where(eq(sources.adapterKey, 'manual')))[0];
  if (!manual) {
    [manual] = await db.insert(sources)
      .values({ adapterKey: 'manual', name: 'Manual entries', enabled: false, config: {} })
      .returning();
    console.log(`[ryzer] created sources row (${manual!.id})`);
  } else {
    console.log(`[ryzer] reusing existing "Manual entries" source (${manual.id})`);
  }

  const events = await ryzerSearch(SEARCH_ZIP, SEARCH_RADIUS);
  console.log(`[ryzer] search returned ${events.length} events within ${SEARCH_RADIUS}mi of ${SEARCH_ZIP}`);

  const todayIso = new Date().toISOString().slice(0, 10);
  let inserted = 0, skipped = 0;
  for (const e of events) {
    const org = (e.organizer || '').trim();
    if (SKIP_ORGANIZERS.has(org)) { skipped++; continue; }
    if (e.registrationOver) { skipped++; continue; }
    const startIso = toIsoDate(e.startdate);
    const endIso = toIsoDate(e.enddate) || startIso;
    if (!startIso) { console.warn(`  ! unparseable date for ${e.name}: ${e.daterange}`); skipped++; continue; }
    if (startIso < todayIso) { skipped++; continue; }

    const coord = CITY_COORDS[(e.city || '').trim().toLowerCase()] || FALLBACK_COORD;
    const venueName = org.includes(' - ') ? org.split(' - ')[0].trim() : (org || e.city);
    const { min, max } = parseCostCents(e.cost || '');
    const ages = parseRange(e.agerange || '');
    const sourceEventId = `ryzer-${e.id}`;
    const description =
      `${e.eventtype} (${e.activitytype}) hosted by ${org} in ${e.city}, ${e.state}. ` +
      `${e.daterange}. Cost: ${e.cost || 'see registration'}. ` +
      `${e.agerange ? `Ages ${e.agerange}.` : e.graderange ? `${e.graderange}.` : ''} ` +
      `Exact times/location are on the registration page. Register via Ryzer.`;

    await db.insert(activities).values({
      sourceId: manual!.id,
      sourceEventId,
      title: e.name,
      description: description.replace(/\s+/g, ' ').trim(),
      startAt: new Date(`${startIso}T09:00:00-04:00`),
      endAt: new Date(`${endIso}T16:00:00-04:00`),
      timezone: 'America/New_York',
      venueName,
      address: null,
      city: e.city.trim(),
      region: e.state,
      country: 'US',
      location: coord,
      ageMin: ages.lo,
      ageMax: ages.hi,
      costMinCents: min,
      costMaxCents: max,
      currency: 'USD',
      availability: max === 0 ? 'free' : 'onsale',
      isVirtual: false,
      organizerName: org,
      organizerUrl: e.rlink || null,
      organizerKey: `ryzer-${slug(org)}`,
      url: e.rlink,
      imageUrl: e.logo || null,
      categories: ['sports', 'camps'],
      raw: {
        source: 'ryzer-eventsearch',
        createdBy: 'script:ingest-ryzer-harrisonburg-camps',
        ryzerId: e.id,
        rlink: e.rlink,
        importedAt: new Date().toISOString(),
      },
    }).onConflictDoUpdate({
      target: [activities.sourceId, activities.sourceEventId],
      set: {
        title: e.name,
        description: description.replace(/\s+/g, ' ').trim(),
        startAt: new Date(`${startIso}T09:00:00-04:00`),
        endAt: new Date(`${endIso}T16:00:00-04:00`),
        costMinCents: min,
        costMaxCents: max,
      },
    });
    console.log(`  ~ ${startIso}  ${e.city}  ${e.activitytype}  ${e.name}  [${org}]`);
    inserted++;
  }
  console.log(`[ryzer] done — upserted ${inserted}, skipped ${skipped} (dupes/past/over)`);
  process.exit(0);
}

main().catch((e) => { console.error('[ryzer] failed:', e); process.exit(1); });
