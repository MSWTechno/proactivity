import { db, activities, sources, sql } from '@proactivity/db';
import { eq, inArray, sql as drizzleSql } from 'drizzle-orm';
import { getAdapter, isPassiveAdapter } from './registry.js';
import type { NormalizedActivity } from './types.js';
import { deriveOrganizerKey } from './organizer.js';

const BATCH_SIZE = 100;
// Number of sources to ingest in parallel. Tuned so the postgres.js pool
// (default 10) and outbound HTTP both stay comfortable. Bump via the
// INGEST_CONCURRENCY env var if you've grown past ~20 sources and want
// faster cron wallclock.
const DEFAULT_CONCURRENCY = 4;

/**
 * Per-host caps on how many sources may run in a single sweep.
 *
 * Why this exists: http.ts serializes requests per host to stay under rate
 * limits, so a host's throughput is fixed no matter how many workers we run.
 * Eventbrite paces at ~1 req/s and each metro source costs ~25-35 requests,
 * so all 32 VA metros in one sweep is 13-18 minutes — far past any function
 * timeout. Instead we rotate: each run takes the least-recently-run sources
 * for that host, so every metro still gets refreshed, just on a cycle rather
 * than daily.
 *
 * Cap of 4 => a full pass over 32 Eventbrite metros every 8 days, at roughly
 * 135s of Eventbrite time per run.
 */
const HOST_ROTATION: Array<[RegExp, number]> = [[/(^|\.)eventbrite\.com$/, 4]];

type SourceRow = typeof sources.$inferSelect;

/** Best-effort host for a source, across the differing adapter config shapes. */
function sourceHost(source: SourceRow): string | null {
  const cfg = source.config as Record<string, unknown> | null;
  const raw = cfg?.entryUrl ?? cfg?.url ?? cfg?.baseUrl;
  if (typeof raw !== 'string') return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

/**
 * Apply HOST_ROTATION, returning the sources to run this sweep. Selection is
 * least-recently-run first (never-run wins outright), which self-balances as
 * sources are added or removed and needs no extra bookkeeping column.
 */
export function selectSourcesForRun(enabled: SourceRow[]): {
  selected: SourceRow[];
  skipped: SourceRow[];
} {
  const selected: SourceRow[] = [];
  const skipped: SourceRow[] = [];
  const capped = new Map<RegExp, SourceRow[]>();

  for (const source of enabled) {
    const host = sourceHost(source);
    const rule = host ? HOST_ROTATION.find(([pattern]) => pattern.test(host)) : undefined;
    if (!rule) {
      selected.push(source);
      continue;
    }
    const bucket = capped.get(rule[0]) ?? [];
    bucket.push(source);
    capped.set(rule[0], bucket);
  }

  for (const [pattern, bucket] of capped) {
    const limit = HOST_ROTATION.find(([p]) => p === pattern)![1];
    // Nulls (never run) first, then oldest last_run_at.
    bucket.sort((a, b) => {
      const at = a.lastRunAt?.getTime() ?? -Infinity;
      const bt = b.lastRunAt?.getTime() ?? -Infinity;
      return at - bt;
    });
    selected.push(...bucket.slice(0, limit));
    skipped.push(...bucket.slice(limit));
  }

  return { selected, skipped };
}

export async function runAllSources(): Promise<void> {
  const enabledRows = await db.select().from(sources).where(eq(sources.enabled, true));
  // Passive sources have no feed — drop them before selection so they neither
  // consume a worker slot nor land in the rotation logging as if deferred.
  const allEnabled = enabledRows.filter((s) => !isPassiveAdapter(s.adapterKey));
  const passive = enabledRows.filter((s) => isPassiveAdapter(s.adapterKey));
  if (passive.length > 0) {
    console.log(
      `[runner] skipping ${passive.length} passive source(s) with nothing to fetch: ` +
        passive.map((s) => `${s.name} (${s.adapterKey})`).join(', '),
    );
    // Clear any error left by an older build that treated these as unknown
    // adapters, so the admin health view isn't permanently red.
    await db
      .update(sources)
      .set({ lastStatus: 'passive', lastError: null })
      .where(inArray(sources.id, passive.map((s) => s.id)));
  }
  if (allEnabled.length === 0) {
    console.log('No enabled sources. Insert a row into `sources` to start ingesting.');
    return;
  }

  const { selected: enabled, skipped } = selectSourcesForRun(allEnabled);
  if (skipped.length > 0) {
    // Never let a coverage cap be silent — a short run would otherwise read
    // as "everything refreshed".
    const oldest = skipped.reduce<Date | null>(
      (acc, s) => (s.lastRunAt && (!acc || s.lastRunAt < acc) ? s.lastRunAt : acc),
      null,
    );
    console.log(
      `[runner] rotation: running ${enabled.length}/${allEnabled.length} sources; ` +
        `${skipped.length} deferred to a later run` +
        (oldest ? ` (oldest deferred last ran ${oldest.toISOString()})` : ''),
    );
  }

  const concurrency = (() => {
    const raw = process.env.INGEST_CONCURRENCY;
    if (!raw) return DEFAULT_CONCURRENCY;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 20) return DEFAULT_CONCURRENCY;
    return n;
  })();
  const workerCount = Math.min(concurrency, enabled.length);

  console.log(`[runner] starting ${enabled.length} sources with concurrency=${workerCount}`);
  const startedAt = Date.now();

  // Shared queue cursor — each worker pulls the next source until empty.
  // runSource already catches its own errors and writes them to the
  // sources.last_error column, so one failing feed doesn't poison the batch.
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= enabled.length) return;
      const source = enabled[idx]!;
      try {
        await runSource(source.id, source.adapterKey, source.name, source.config);
      } catch (e) {
        // Belt-and-suspenders — runSource normally swallows its own errors.
        console.error(`[runner] unexpected throw from runSource(${source.name}):`, e);
      }
    }
  });
  await Promise.all(workers);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[runner] all ${enabled.length} sources done in ${elapsed}s`);

  await prunePastActivities();
}

/**
 * Retention for past events, in days.
 *
 * Floor is set by the API, not by storage: /api/activities?daysAhead=past
 * serves events back 90 days, and the sitemap keeps past events listed for 30
 * so Google can deindex them without hitting a 404. 120 leaves a month of
 * slack under the binding 90-day constraint — do not lower this below 90
 * without changing that query first.
 */
const PAST_RETENTION_DAYS = 120;

/**
 * Drop past events nobody can reach any more.
 *
 * Note on expectations: at the time this was added only ~1% of rows were old
 * enough to qualify, so this is not a meaningful storage saving today — it's
 * a bound on unchecked growth now that ingestion runs nightly across the
 * whole state. Rows an admin or organizer hand-edited are preserved
 * regardless of age; they represent work that can't be re-fetched.
 *
 * Deleting an activity cascades to event_drafts.activity_id by FK. Ratings
 * reference activities by a polymorphic (target_kind, target_key) pair with
 * no FK, so target_kind='event' ratings for pruned activities are cleaned up
 * alongside — target_kind='organizer' ratings key off organizer_key and
 * survive the event they were left on.
 */
export async function prunePastActivities(): Promise<void> {
  try {
    const deleted = await sql`
      WITH pruned AS (
        DELETE FROM activities
        WHERE COALESCE(end_at, start_at) < now() - (${PAST_RETENTION_DAYS}::int * interval '1 day')
          AND manual_override = false
        RETURNING id
      ), orphaned_ratings AS (
        DELETE FROM ratings
        WHERE target_kind = 'event'
          AND target_key IN (SELECT id::text FROM pruned)
        RETURNING id
      )
      SELECT
        (SELECT count(*) FROM pruned) AS activities,
        (SELECT count(*) FROM orphaned_ratings) AS ratings
    `;
    const row = deleted[0];
    if (row && Number(row.activities) > 0) {
      console.log(
        `[runner] pruned ${row.activities} activities older than ` +
          `${PAST_RETENTION_DAYS}d (and ${row.ratings} orphaned ratings)`,
      );
    }
  } catch (err) {
    // Never let retention failure fail an otherwise-good ingest run.
    console.error('[runner] prune failed:', err instanceof Error ? err.message : err);
  }
}

export async function runSource(
  sourceId: string,
  adapterKey: string,
  sourceName: string,
  config: Record<string, unknown>,
): Promise<void> {
  if (isPassiveAdapter(adapterKey)) {
    // Hand-entered rows — nothing to fetch. Treated as a no-op rather than a
    // failure, including when an admin hits "Re-ingest" on one by hand.
    console.log(`[${sourceName}] passive source (adapter=${adapterKey}) — nothing to fetch`);
    await db
      .update(sources)
      .set({ lastStatus: 'passive', lastError: null })
      .where(eq(sources.id, sourceId));
    return;
  }

  const adapter = getAdapter(adapterKey);
  if (!adapter) {
    console.error(`[${sourceName}] no adapter registered for key "${adapterKey}"`);
    await db
      .update(sources)
      .set({ lastStatus: 'error', lastError: `unknown adapter: ${adapterKey}`, lastRunAt: new Date() })
      .where(eq(sources.id, sourceId));
    return;
  }

  console.log(`[${sourceName}] starting (adapter=${adapterKey})`);
  const startedAt = Date.now();
  let buffer: NormalizedActivity[] = [];
  let total = 0;

  try {
    for await (const item of adapter.fetch({ config })) {
      buffer.push(item);
      if (buffer.length >= BATCH_SIZE) {
        await upsertBatch(sourceId, buffer);
        total += buffer.length;
        buffer = [];
      }
    }
    if (buffer.length > 0) {
      await upsertBatch(sourceId, buffer);
      total += buffer.length;
    }

    await db
      .update(sources)
      .set({ lastStatus: 'ok', lastError: null, lastRunAt: new Date() })
      .where(eq(sources.id, sourceId));

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[${sourceName}] done — ${total} activities in ${elapsed}s`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${sourceName}] failed:`, message);
    await db
      .update(sources)
      .set({ lastStatus: 'error', lastError: message, lastRunAt: new Date() })
      .where(eq(sources.id, sourceId));
  }
}

async function upsertBatch(sourceId: string, items: NormalizedActivity[]): Promise<void> {
  // Drizzle's customType handles location → EWKT string binding.
  // For onConflictDoUpdate we refresh all mutable fields with `excluded.X`.
  await db
    .insert(activities)
    .values(
      items.map((a) => ({
        sourceId,
        sourceEventId: a.sourceEventId,
        title: a.title,
        description: a.description ?? null,
        startAt: a.startAt,
        endAt: a.endAt ?? null,
        timezone: a.timezone ?? null,
        venueName: a.venueName ?? null,
        address: a.address ?? null,
        city: a.city ?? null,
        region: a.region ?? null,
        country: a.country ?? null,
        // Drizzle geometry tuple mode wants [lng, lat]; adapters use {lng,lat}.
        location: a.location ? ([a.location.lng, a.location.lat] as [number, number]) : null,
        ageMin: a.ageMin ?? null,
        ageMax: a.ageMax ?? null,
        costMinCents: a.costMinCents ?? null,
        costMaxCents: a.costMaxCents ?? null,
        currency: a.currency ?? 'USD',
        availability: a.availability,
        isVirtual: a.isVirtual ?? false,
        organizerName: a.organizerName ?? null,
        organizerUrl: a.organizerUrl ?? null,
        organizerKey: a.organizerKey ?? deriveOrganizerKey(a.organizerName, a.organizerUrl),
        url: a.url ?? null,
        imageUrl: a.imageUrl ?? null,
        categories: a.categories ?? null,
        raw: a.raw as object,
        updatedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [activities.sourceId, activities.sourceEventId],
      // Two guards:
      //  1. Don't clobber rows admins (or approved organizer drafts) edited.
      //  2. Don't rewrite rows whose content is byte-for-byte unchanged.
      //
      // (2) matters for cost, not correctness. Most feeds republish the same
      // events every night, so the old unconditional upsert rewrote the whole
      // table daily — every row a new tuple plus WAL, for no change at all.
      // Skipping the no-ops keeps dead tuples (and the vacuum churn behind
      // them) proportional to real edits.
      //
      // `updated_at` is deliberately absent from the comparison: it's set to
      // now() on every batch, so including it would make every row differ and
      // defeat the check. `location` is geometry — compared as text because
      // the geometry `=` operator has meant different things across PostGIS
      // versions, while its text form is a deterministic EWKB hex string.
      setWhere: drizzleSql`
        activities.manual_override = false
        AND (
          activities.title,
          activities.description,
          activities.start_at,
          activities.end_at,
          activities.timezone,
          activities.venue_name,
          activities.address,
          activities.city,
          activities.region,
          activities.country,
          activities.location::text,
          activities.age_min,
          activities.age_max,
          activities.cost_min_cents,
          activities.cost_max_cents,
          activities.currency,
          activities.availability,
          activities.is_virtual,
          activities.organizer_name,
          activities.organizer_url,
          activities.organizer_key,
          activities.url,
          activities.image_url,
          activities.categories,
          activities.raw
        ) IS DISTINCT FROM (
          excluded.title,
          excluded.description,
          excluded.start_at,
          excluded.end_at,
          excluded.timezone,
          excluded.venue_name,
          excluded.address,
          excluded.city,
          excluded.region,
          excluded.country,
          excluded.location::text,
          excluded.age_min,
          excluded.age_max,
          excluded.cost_min_cents,
          excluded.cost_max_cents,
          excluded.currency,
          excluded.availability,
          excluded.is_virtual,
          excluded.organizer_name,
          excluded.organizer_url,
          excluded.organizer_key,
          excluded.url,
          excluded.image_url,
          excluded.categories,
          excluded.raw
        )
      `,
      set: {
        title: drizzleSql`excluded.title`,
        description: drizzleSql`excluded.description`,
        startAt: drizzleSql`excluded.start_at`,
        endAt: drizzleSql`excluded.end_at`,
        timezone: drizzleSql`excluded.timezone`,
        venueName: drizzleSql`excluded.venue_name`,
        address: drizzleSql`excluded.address`,
        city: drizzleSql`excluded.city`,
        region: drizzleSql`excluded.region`,
        country: drizzleSql`excluded.country`,
        location: drizzleSql`excluded.location`,
        ageMin: drizzleSql`excluded.age_min`,
        ageMax: drizzleSql`excluded.age_max`,
        costMinCents: drizzleSql`excluded.cost_min_cents`,
        costMaxCents: drizzleSql`excluded.cost_max_cents`,
        currency: drizzleSql`excluded.currency`,
        availability: drizzleSql`excluded.availability`,
        isVirtual: drizzleSql`excluded.is_virtual`,
        organizerName: drizzleSql`excluded.organizer_name`,
        organizerUrl: drizzleSql`excluded.organizer_url`,
        organizerKey: drizzleSql`excluded.organizer_key`,
        url: drizzleSql`excluded.url`,
        imageUrl: drizzleSql`excluded.image_url`,
        categories: drizzleSql`excluded.categories`,
        raw: drizzleSql`excluded.raw`,
        updatedAt: drizzleSql`excluded.updated_at`,
      },
    });
}
