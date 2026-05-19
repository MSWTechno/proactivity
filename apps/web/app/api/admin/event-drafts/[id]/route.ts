import { NextResponse } from 'next/server';
import { db, eventDrafts, users, sql } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import { generateOccurrences } from '@/lib/recurrence';
import { notifyDraftResolved } from '@/lib/email';

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

  // Look up the submitter's email up front so we can notify either branch.
  const userRow = (await db.select({ email: users.email }).from(users).where(eq(users.id, draft.userId)).limit(1))[0];
  const submitterEmail = userRow?.email ?? null;

  const recurrence = draft.recurrenceFreq && draft.recurrenceCount
    ? {
        freq: draft.recurrenceFreq,
        count: draft.recurrenceCount,
        skipCount: draft.recurrenceSkipDates?.length ?? 0,
      }
    : null;

  if (body.action === 'reject') {
    await db
      .update(eventDrafts)
      .set({ status: 'rejected', moderatorNote: note, resolvedAt: new Date() })
      .where(eq(eventDrafts.id, id));
    if (submitterEmail) {
      await notifyDraftResolved({
        to: submitterEmail,
        title: draft.title ?? '(untitled)',
        action: 'rejected',
        moderatorNote: note,
        recurrence,
      });
    }
    return NextResponse.json({ ok: true });
  }

  // APPROVE. All writes (source create, N activity inserts, draft finalize)
  // run in a single transaction so a partial failure doesn't publish half a
  // recurrence with the draft still pending.
  const locationExpr = draft.lat != null && draft.lng != null
    ? sql`ST_SetSRID(ST_MakePoint(${draft.lng}, ${draft.lat}), 4326)`
    : null;

  // postgres.js 3.4 transaction handles don't auto-encode Date params inside
  // template tags (they fall through to a string-typing path that throws).
  // Convert Dates to ISO strings and cast in SQL.
  const startIso = draft.startAt ? draft.startAt.toISOString() : null;
  const endIso = draft.endAt ? draft.endAt.toISOString() : null;

  await sql.begin(async (sq) => {
    if (draft.activityId) {
      await sq`
        UPDATE activities SET
          title = COALESCE(${draft.title}, title),
          description = ${draft.description},
          start_at = COALESCE(${startIso}::timestamptz, start_at),
          end_at = ${endIso}::timestamptz,
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
      // Find-or-create a per-organizer "Organizer:<name>" source. enabled=false
      // so ingestion never runs against it.
      const sourceName = `Organizer: ${draft.organizerName ?? draft.organizerKey}`;
      const existing = (await sq`SELECT id FROM sources WHERE name = ${sourceName} LIMIT 1`) as { id: string }[];
      const sourceId = existing[0]?.id ?? (
        (await sq`
          INSERT INTO sources (adapter_key, name, enabled, config)
          VALUES ('organizer', ${sourceName}, false, ${JSON.stringify({ organizerKey: draft.organizerKey })}::jsonb)
          RETURNING id
        `) as { id: string }[]
      )[0]!.id;

      const slug = (draft.title ?? 'event')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

      const occurrences = generateOccurrences(
        draft.startAt!,
        draft.endAt,
        draft.recurrenceFreq,
        draft.recurrenceCount,
        draft.recurrenceSkipDates,
        draft.timezone ?? 'America/New_York',
      );

      for (const occ of occurrences) {
        const sourceEventId = `org-${slug}-${occ.dateKey}-${id.slice(0, 8)}`;
        const occStartIso = occ.start.toISOString();
        const occEndIso = occ.end ? occ.end.toISOString() : null;
        await sq`
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
            ${occStartIso}::timestamptz, ${occEndIso}::timestamptz, ${draft.timezone ?? 'America/New_York'},
            ${draft.venueName}, ${draft.address}, ${draft.city}, ${draft.region},
            ${locationExpr},
            ${draft.ageMin}, ${draft.ageMax},
            ${draft.costMinCents}, ${draft.costMaxCents}, ${draft.currency ?? 'USD'},
            ${draft.availability ?? 'onsale'}, false,
            ${draft.organizerName}, ${draft.organizerUrl}, ${draft.organizerKey},
            ${draft.url}, ${draft.imageUrl}, ${draft.categories ?? null},
            ${JSON.stringify({ source: 'organizer_draft', draftId: id, occurrence: occStartIso })}::jsonb, true
          )
          ON CONFLICT (source_id, source_event_id) DO NOTHING
        `;
      }
    }

    await sq`
      UPDATE event_drafts
      SET status = 'approved', moderator_note = ${note}, resolved_at = now()
      WHERE id = ${id}
    `;
  });

  if (submitterEmail) {
    await notifyDraftResolved({
      to: submitterEmail,
      title: draft.title ?? '(untitled)',
      action: 'approved',
      moderatorNote: note,
      recurrence,
    });
  }

  return NextResponse.json({ ok: true });
}

