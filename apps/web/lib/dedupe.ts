import { sql } from '@proactivity/db';

/**
 * A composable postgres-js fragment. Bare `ReturnType<typeof sql>` defaults its
 * row-type parameter to something narrower than what a real query produces, so
 * pin it explicitly — this only ever gets interpolated, never awaited here.
 */
type SqlFragment = ReturnType<typeof sql<any[]>>;

/**
 * Cross-source de-duplication for the reader-facing feeds.
 *
 * The DB's only uniqueness guarantee is `(source_id, source_event_id)` — it is
 * scoped *per source*, so the same real-world event lands more than once in two
 * situations we actually see in production:
 *
 *   Class A — same `source_event_id`, different source. Nested feeds (JMU
 *     Athletics is a subset of the JMU Master Calendar) and overlapping metro
 *     tiles (Meetup Arlington/Fairfax, adjacent Eventbrite cities) pull the
 *     identical feed item in twice.
 *
 *   Class B — same real event, *different* `source_event_id`. JMU's EMS
 *     calendar publishes one game under several EventDetails ids (one per
 *     calendar category), so no id-based key can catch it. Requires matching on
 *     event identity instead: title + start + venue + coords.
 *
 * De-duplication happens at read time rather than at ingest: it is reversible,
 * loses no data, needs no re-ingest, and — unlike deleting rows — survives the
 * next sweep re-inserting them.
 *
 * The two passes MUST be chained (class A, then class B over only the
 * survivors) rather than evaluated together over one set. Two rows can share a
 * `source_event_id` but differ on the identity key, because a source with no
 * resolvable venue stamps its own hub coords. Computed in a single pass, the
 * best row of an identity group can lose the source-event pass while every
 * other row of that group loses the identity pass — dropping the event
 * entirely. Chaining keeps at least one row per group at every stage.
 *
 * The base query passed to {@link dedupePipeline} must expose these columns:
 * `id, source_event_id, title, start_at, venue_name, city, image_url,
 * description`. The output carries two extra int columns (`dedupe_rn_a`,
 * `dedupe_rn_b`); callers map rows by name and ignore them.
 */

/**
 * Which row wins inside a duplicate group: the one carrying the most for the
 * card to render. `id` is last and is unique, so the winner is deterministic —
 * without a total order Postgres could return a different survivor per query
 * and infinite scroll would tear across pages.
 */
const PREFERENCE = sql`
  (image_url IS NOT NULL) DESC,
  length(COALESCE(description, '')) DESC,
  (venue_name IS NOT NULL) DESC,
  id
`;

/**
 * Event identity for class B: normalised title + exact start + venue + city.
 *
 * Deliberately NOT keyed on coordinates. The same event routinely carries
 * different coords across sources — one resolves the venue and geocodes it,
 * another falls back to stamping its own hub — and the offsets (~300m for a
 * geocode-vs-hub split, tens of km for two metro tiles) straddle any rounding
 * boundary, so a grid never reliably reunites them. Measured over the upcoming
 * set, a coord-free key merges 88 groups, of which only 6 span more than 2km —
 * and all 6 are one event stamped at several metro-tile centres (a single expo
 * appearing at 4 tiles 286km apart), i.e. merges we want.
 *
 * Residual risk: two genuinely distinct events sharing a normalised title, an
 * exact start timestamp, and a blank venue and city would collapse into one.
 * 55% of upcoming rows have neither venue nor city, so this is not impossible —
 * a chain event at the same hour in two towns is the realistic shape. It is
 * accepted because it needs a second-exact start collision to trigger, and
 * because the pipeline runs *after* each query's radius filter: a merge can only
 * ever occur between rows already inside the same result set, so it can never
 * move an event into or out of a user's radius.
 */
const IDENTITY_KEY = sql`
  -- POSIX class, not '\s': a backslash escape does not survive the trip from
  -- JS template literal through to the server intact, and silently degrades to
  -- the literal 's' — which collapses the letter s instead of whitespace.
  lower(regexp_replace(btrim(title), '[[:space:]]+', ' ', 'g')),
  start_at,
  lower(COALESCE(venue_name, '')),
  lower(COALESCE(city, ''))
`;

/**
 * Wrap a base SELECT in the two de-duplication passes. Returns a fragment that
 * is a complete SELECT, so callers append their own ORDER BY / LIMIT / OFFSET:
 *
 * ```ts
 * const rows = await sql`
 *   ${dedupePipeline(sql`SELECT ... FROM activities a WHERE ...`)}
 *   ORDER BY start_at ASC
 *   LIMIT ${n}
 * `;
 * ```
 *
 * Note the ordering and paging apply to the de-duplicated set, which is the
 * point: dropping duplicates after LIMIT would return short pages.
 */
export function dedupePipeline(base: SqlFragment) {
  return sql`
    WITH dedupe_base AS (
      ${base}
    ),
    -- Class A: identical feed item reached us through two sources.
    dedupe_pass_a AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY source_event_id ORDER BY ${PREFERENCE}) AS dedupe_rn_a
      FROM dedupe_base
    ),
    -- Class B: one real event published under several distinct feed ids.
    dedupe_pass_b AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY ${IDENTITY_KEY} ORDER BY ${PREFERENCE}) AS dedupe_rn_b
      FROM dedupe_pass_a
      WHERE dedupe_rn_a = 1
    )
    SELECT * FROM dedupe_pass_b WHERE dedupe_rn_b = 1
  `;
}
