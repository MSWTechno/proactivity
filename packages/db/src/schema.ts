import {
  boolean,
  geometry,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Stored as PostGIS geometry(Point, 4326) for index compatibility; queries
// cast to ::geography when meter-accurate distance is needed.
// drizzle's geometry helper accepts/returns [lng, lat] tuples.

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  adapterKey: text('adapter_key').notNull(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  // { lat: number, lng: number, radiusKm: number, ...adapter-specific }
  config: jsonb('config').notNull().$type<Record<string, unknown>>(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceEventId: text('source_event_id').notNull(),

    title: text('title').notNull(),
    description: text('description'),

    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }),
    timezone: text('timezone'),

    venueName: text('venue_name'),
    address: text('address'),
    city: text('city'),
    region: text('region'),
    country: text('country'),
    // [lng, lat] tuple in code; geometry(Point, 4326) in DB.
    location: geometry('location', { type: 'point', mode: 'tuple', srid: 4326 }),

    // Organizer identity (extracted by adapters when available).
    // organizer_key is a stable slug derived from URL (preferred) or name —
    // shared across sources so ratings aggregate globally for an organizer
    // that posts to multiple platforms.
    organizerName: text('organizer_name'),
    organizerUrl: text('organizer_url'),
    organizerKey: text('organizer_key'),

    ageMin: integer('age_min'),
    ageMax: integer('age_max'),

    costMinCents: integer('cost_min_cents'),
    costMaxCents: integer('cost_max_cents'),
    currency: text('currency').default('USD'),

    // Last-minute-attendability signal.
    // 'onsale' = ticket still buyable, 'free' = no ticket, 'dropin' = walk-up,
    // 'sold_out' / 'cancelled' / 'unknown' = excluded from default UI filter.
    availability: text('availability').notNull().default('unknown'),

    url: text('url'),
    imageUrl: text('image_url'),
    categories: text('categories').array(),

    raw: jsonb('raw').notNull(),

    // Behind-the-scenes popularity counter, incremented when a user taps
    // through to this event. Preserved across re-ingestions (not in the
    // upsert SET clause).
    clickCount: integer('click_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceEventUnique: uniqueIndex('activities_source_event_unique').on(t.sourceId, t.sourceEventId),
    startAtIdx: index('activities_start_at_idx').on(t.startAt),
    locationIdx: index('activities_location_idx').using('gist', t.location),
    availabilityIdx: index('activities_availability_idx').on(t.availability),
    organizerKeyIdx: index('activities_organizer_key_idx').on(t.organizerKey),
  }),
);

/**
 * Aggregated click counts per category key. Used to order the chip row by
 * site-wide popularity. Tiny table (one row per category) — no indexing
 * beyond the primary key needed.
 */
export const categoryClicks = pgTable('category_clicks', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * User-submitted ratings + reviews. Submitted as `pending`, then approved
 * or rejected by an admin via the CLI. Once approved, displayed publicly.
 *
 * `target_kind` = 'event' targets a recurring event series. We use the
 * source's event id stripped of any "::<occurrence>" suffix as the key so
 * all occurrences of e.g. weekly trivia share ratings.
 * (Future: 'organizer' once adapters extract organizer identity.)
 */
export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable for organizer ratings (global identity, no source scope).
    // For event ratings this is always set to the activity's source.
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }),
    targetKind: text('target_kind').notNull(), // 'event' | 'organizer'
    targetKey: text('target_key').notNull(),

    submitterName: text('submitter_name'),
    submitterEmail: text('submitter_email'),
    submitterIp: text('submitter_ip'),

    score: integer('score').notNull(), // 1..5
    review: text('review'),

    status: text('status').notNull().default('pending'), // 'pending'|'approved'|'rejected'
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    moderatorNote: text('moderator_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    targetIdx: index('ratings_target_idx').on(t.targetKind, t.targetKey, t.status),
    statusIdx: index('ratings_status_idx').on(t.status, t.createdAt),
  }),
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type CategoryClick = typeof categoryClicks.$inferSelect;
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;
