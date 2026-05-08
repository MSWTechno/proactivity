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

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceEventUnique: uniqueIndex('activities_source_event_unique').on(t.sourceId, t.sourceEventId),
    startAtIdx: index('activities_start_at_idx').on(t.startAt),
    locationIdx: index('activities_location_idx').using('gist', t.location),
    availabilityIdx: index('activities_availability_idx').on(t.availability),
  }),
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
