import { sql } from '@proactivity/db';

// Harrisonburg default center (matches product focus geo) + 25km radius.
const LAT = 38.4496;
const LNG = -78.8689;
const RADIUS_KM = 25;

async function main() {
  const rows = (await sql`
    SELECT
      a.organizer_key,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE a.url IS NOT NULL AND a.url <> '') AS has_url,
      COUNT(*) FILTER (WHERE COALESCE(a.end_at, a.start_at) >= now()) AS upcoming,
      COUNT(*) FILTER (WHERE a.availability IN ('onsale','free','dropin')) AS available,
      -- Fully feed-eligible (ignoring virtual heuristic + category, which run in JS):
      COUNT(*) FILTER (
        WHERE a.url IS NOT NULL AND a.url <> ''
          AND COALESCE(a.end_at, a.start_at) >= now()
          AND a.availability IN ('onsale','free','dropin')
      ) AS feed_eligible,
      -- Of those, within 25km of Harrisonburg:
      COUNT(*) FILTER (
        WHERE a.url IS NOT NULL AND a.url <> ''
          AND COALESCE(a.end_at, a.start_at) >= now()
          AND a.availability IN ('onsale','free','dropin')
          AND ST_DWithin(
            a.location::geography,
            ST_SetSRID(ST_MakePoint(${LNG}, ${LAT}), 4326)::geography,
            ${RADIUS_KM * 1000})
      ) AS in_radius,
      -- Within the 7-day last-minute window AND in radius:
      COUNT(*) FILTER (
        WHERE a.url IS NOT NULL AND a.url <> ''
          AND COALESCE(a.end_at, a.start_at) >= now()
          AND a.start_at <= now() + interval '7 days'
          AND a.availability IN ('onsale','free','dropin')
          AND ST_DWithin(
            a.location::geography,
            ST_SetSRID(ST_MakePoint(${LNG}, ${LAT}), 4326)::geography,
            ${RADIUS_KM * 1000})
      ) AS next7_in_radius,
      MIN(a.start_at) FILTER (WHERE COALESCE(a.end_at, a.start_at) >= now()) AS next_start
    FROM activities a
    WHERE a.source_id = (SELECT id FROM sources WHERE adapter_key = 'manual' LIMIT 1)
    GROUP BY a.organizer_key
    ORDER BY a.organizer_key
  `) as any[];

  console.log('manual-source events by organizer_key (now =', new Date().toISOString(), ')\n');
  for (const r of rows) {
    console.log(`${r.organizer_key ?? '(null)'}`);
    console.log(
      `  total=${r.total}  has_url=${r.has_url}  upcoming=${r.upcoming}  available=${r.available}`
    );
    console.log(
      `  feed_eligible=${r.feed_eligible}  in_radius=${r.in_radius}  next7_in_radius=${r.next7_in_radius}` +
        `  next_start=${r.next_start ? new Date(r.next_start).toISOString().slice(0, 16) : '—'}`
    );
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
