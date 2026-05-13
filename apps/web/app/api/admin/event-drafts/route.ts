import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/event-drafts
 * Lists pending drafts with a snapshot of the existing activity (when this
 * is an edit) so the admin UI can render a diff.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (guard) return NextResponse.json(guard.body, { status: guard.status });

  const rows = (await sql`
    SELECT
      d.id, d.organizer_key, d.activity_id, d.title, d.description,
      d.start_at, d.end_at, d.timezone, d.venue_name, d.address, d.city,
      d.region, d.lat, d.lng, d.age_min, d.age_max, d.cost_min_cents,
      d.cost_max_cents, d.currency, d.availability, d.organizer_name,
      d.organizer_url, d.url, d.image_url, d.categories, d.created_at,
      u.email AS submitter_email,
      u.name AS submitter_name,
      a.title AS existing_title,
      a.description AS existing_description,
      a.start_at AS existing_start_at,
      a.end_at AS existing_end_at,
      a.venue_name AS existing_venue_name,
      a.address AS existing_address,
      a.city AS existing_city,
      a.region AS existing_region,
      a.cost_min_cents AS existing_cost_min_cents,
      a.cost_max_cents AS existing_cost_max_cents,
      a.availability AS existing_availability,
      a.organizer_name AS existing_organizer_name,
      a.organizer_url AS existing_organizer_url,
      a.url AS existing_url,
      a.image_url AS existing_image_url,
      a.categories AS existing_categories
    FROM event_drafts d
    JOIN users u ON u.id = d.user_id
    LEFT JOIN activities a ON a.id = d.activity_id
    WHERE d.status = 'pending'
    ORDER BY d.created_at ASC
    LIMIT 200
  `) as unknown as Array<Record<string, unknown>>;

  return NextResponse.json({
    drafts: rows.map((r) => ({
      id: r.id,
      organizerKey: r.organizer_key,
      activityId: r.activity_id,
      submitter: { email: r.submitter_email, name: r.submitter_name },
      proposed: {
        title: r.title,
        description: r.description,
        startAt: r.start_at,
        endAt: r.end_at,
        timezone: r.timezone,
        venueName: r.venue_name,
        address: r.address,
        city: r.city,
        region: r.region,
        lat: r.lat,
        lng: r.lng,
        ageMin: r.age_min,
        ageMax: r.age_max,
        costMinCents: r.cost_min_cents,
        costMaxCents: r.cost_max_cents,
        currency: r.currency,
        availability: r.availability,
        organizerName: r.organizer_name,
        organizerUrl: r.organizer_url,
        url: r.url,
        imageUrl: r.image_url,
        categories: r.categories,
      },
      existing: r.activity_id
        ? {
            title: r.existing_title,
            description: r.existing_description,
            startAt: r.existing_start_at,
            endAt: r.existing_end_at,
            venueName: r.existing_venue_name,
            address: r.existing_address,
            city: r.existing_city,
            region: r.existing_region,
            costMinCents: r.existing_cost_min_cents,
            costMaxCents: r.existing_cost_max_cents,
            availability: r.existing_availability,
            organizerName: r.existing_organizer_name,
            organizerUrl: r.existing_organizer_url,
            url: r.existing_url,
            imageUrl: r.existing_image_url,
            categories: r.existing_categories,
          }
        : null,
      createdAt: r.created_at,
    })),
  });
}
