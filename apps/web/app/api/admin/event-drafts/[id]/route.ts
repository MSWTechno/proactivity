import { NextResponse } from 'next/server';
import { db, eventDrafts, sources, sql } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ActionBody {
  action: 'approve' | 'reject';
  note?: string;
}

/**
 * POST /api/admin/event-drafts/:id
 * Body: { action: 'approve' | 'reject', note? }
 * Approve: write the draft into activities (insert for new, update for edit)
 * and mark manual_override=true so ingestion won't clobber it.
 * Reject: mark draft rejected with note.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const { id } = await ctx.params;
  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  }
  const note = body.note?.trim().slice(0, 2000) ?? null;

  const draft = (await db.select().from(eventDrafts).where(eq(eventDrafts.id, id)).limit(1))[0];
  if (!draft) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (draft.status !== 'pending') {
    return NextResponse.json({ error: `draft already ${draft.status}` }, { status: 409 });
  }

  if (body.action === 'reject') {
    await db
      .update(eventDrafts)
      .set({ status: 'rejected', moderatorNote: note, resolvedAt: new Date() })
      .where(eq(eventDrafts.id, id));
    return NextResponse.json({ ok: true });
  }

  // APPROVE.
  const locationExpr = draft.lat != null && draft.lng != null
    ? sql`ST_SetSRID(ST_MakePoint(${draft.lng}, ${draft.lat}), 4326)`
    : null;

  if (draft.activityId) {
    // Edit to existing event. UPDATE only fields the draft set; null means
    // "no change requested" for optional fields, but for required-ish ones
    // (title, startAt) the draft always carries them so we use them as-is.
    await sql`
      UPDATE activities SET
        title = COALESCE(${draft.title}, title),
        description = ${draft.description},
        start_at = COALESCE(${draft.startAt}, start_at),
        end_at = ${draft.endAt},
        timezone = COALESCE(${draft.timezone}, timezone),
        venue_name = ${draft.venueName},
        address = ${draft.address},
        city = ${draft.city},
        region = ${draft.region},
        ${locationExpr ? sql`location = ${locationExpr},` : sql``}
        age_min = ${draft.ageMin},
        age_max = ${draft.ageMax},
        cost_min_cents = ${draft.costMinCents},
        cost_max_cents = ${draft.costMaxCents},
        currency = COALESCE(${draft.currency}, currency),
        availability = COALESCE(${draft.availability}, availability),
        organizer_name = COALESCE(${draft.organizerName}, organizer_name),
        organizer_url = COALESCE(${draft.organizerUrl}, organizer_url),
        url = COALESCE(${draft.url}, url),
        image_url = ${draft.imageUrl},
        categories = ${draft.categories ?? null},
        manual_override = true,
        updated_at = now()
      WHERE id = ${draft.activityId}
    `;
  } else {
    // New event submission. Find-or-create a per-organizer "Organizer:<name>"
    // source so the row has a sourceId. enabled=false so ingestion never runs
    // against it.
    const sourceName = `Organizer: ${draft.organizerName ?? draft.organizerKey}`;
    const existingSource = (
      await db.select().from(sources).where(eq(sources.name, sourceName)).limit(1)
    )[0];
    const sourceId = existingSource
      ? existingSource.id
      : (
          await db
            .insert(sources)
            .values({
              adapterKey: 'organizer',
              name: sourceName,
              enabled: false,
              config: { organizerKey: draft.organizerKey },
            })
            .returning({ id: sources.id })
        )[0]!.id;

    const slug = (draft.title ?? 'event')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);

    // Expand recurrence into N occurrences (or [draft.startAt] for non-recurring).
    const occurrences = expandRecurrence(
      draft.startAt!,
      draft.endAt,
      draft.recurrenceFreq,
      draft.recurrenceCount,
      draft.recurrenceSkipDates,
    );

    for (const occ of occurrences) {
      const dateKey = occ.start.toISOString().slice(0, 10);
      const sourceEventId = `org-${slug}-${dateKey}-${id.slice(0, 8)}`;
      await sql`
        INSERT INTO activities (
          source_id, source_event_id,
          title, description,
          start_at, end_at, timezone,
          venue_name, address, city, region,
          location,
          age_min, age_max,
          cost_min_cents, cost_max_cents, currency,
          availability, is_virtual,
          organizer_name, organizer_url, organizer_key,
          url, image_url, categories,
          raw, manual_override
        ) VALUES (
          ${sourceId}, ${sourceEventId},
          ${draft.title}, ${draft.description},
          ${occ.start}, ${occ.end}, ${draft.timezone ?? 'America/New_York'},
          ${draft.venueName}, ${draft.address}, ${draft.city}, ${draft.region},
          ${locationExpr},
          ${draft.ageMin}, ${draft.ageMax},
          ${draft.costMinCents}, ${draft.costMaxCents}, ${draft.currency ?? 'USD'},
          ${draft.availability ?? 'onsale'}, false,
          ${draft.organizerName}, ${draft.organizerUrl}, ${draft.organizerKey},
          ${draft.url}, ${draft.imageUrl}, ${draft.categories ?? null},
          ${sql.json({ source: 'organizer_draft', draftId: id, occurrence: occ.start.toISOString() })}, true
        )
        ON CONFLICT (source_id, source_event_id) DO NOTHING
      `;
    }
  }

  await db
    .update(eventDrafts)
    .set({ status: 'approved', moderatorNote: note, resolvedAt: new Date() })
    .where(eq(eventDrafts.id, id));

  return NextResponse.json({ ok: true });
}

/**
 * Expand a recurrence rule into discrete occurrences. Returns [{start, end}]
 * starting from `firstStart`. End is preserved as a constant duration offset
 * from start (if endAt was set). Dates matching skipDates (YYYY-MM-DD in the
 * occurrence's UTC local timezone) are filtered out.
 *
 * For non-recurring drafts (freq null), returns the single original event.
 */
function expandRecurrence(
  firstStart: Date,
  firstEnd: Date | null,
  freq: string | null,
  count: number | null,
  skipDates: string[] | null,
): { start: Date; end: Date | null }[] {
  if (!freq || !count || count < 2) {
    return [{ start: firstStart, end: firstEnd }];
  }
  const durationMs = firstEnd ? firstEnd.getTime() - firstStart.getTime() : null;
  const skip = new Set(skipDates ?? []);
  const out: { start: Date; end: Date | null }[] = [];
  for (let i = 0; i < count; i++) {
    let start: Date;
    if (freq === 'monthly') {
      // setMonth normalizes overflow (e.g., Jan 31 + 1m -> Mar 3 if Feb has 28 days)
      start = new Date(firstStart);
      start.setMonth(start.getMonth() + i);
    } else {
      const stepDays = freq === 'biweekly' ? 14 : 7;
      start = new Date(firstStart.getTime() + i * stepDays * 86400000);
    }
    const dateKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    if (skip.has(dateKey)) continue;
    const end = durationMs != null ? new Date(start.getTime() + durationMs) : null;
    out.push({ start, end });
  }
  return out;
}
