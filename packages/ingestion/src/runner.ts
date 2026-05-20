import { db, activities, sources, sql } from '@proactivity/db';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { getAdapter } from './registry.js';
import type { NormalizedActivity } from './types.js';
import { deriveOrganizerKey } from './organizer.js';

const BATCH_SIZE = 100;
// Number of sources to ingest in parallel. Tuned so the postgres.js pool
// (default 10) and outbound HTTP both stay comfortable. Bump via the
// INGEST_CONCURRENCY env var if you've grown past ~20 sources and want
// faster cron wallclock.
const DEFAULT_CONCURRENCY = 4;

export async function runAllSources(): Promise<void> {
  const enabled = await db.select().from(sources).where(eq(sources.enabled, true));
  if (enabled.length === 0) {
    console.log('No enabled sources. Insert a row into `sources` to start ingesting.');
    return;
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
}

export async function runSource(
  sourceId: string,
  adapterKey: string,
  sourceName: string,
  config: Record<string, unknown>,
): Promise<void> {
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
      // Don't clobber rows admins (or approved organizer drafts) have edited.
      setWhere: drizzleSql`activities.manual_override = false`,
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
