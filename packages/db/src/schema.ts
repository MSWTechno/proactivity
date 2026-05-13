import {
  boolean,
  doublePrecision,
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

    // Set by adapters when source data explicitly marks an event as virtual
    // (e.g. JSON-LD eventAttendanceMode: OnlineEventAttendanceMode).
    // API filter excludes these by default unless ?includeVirtual=1.
    isVirtual: boolean('is_virtual').notNull().default(false),

    url: text('url'),
    imageUrl: text('image_url'),
    categories: text('categories').array(),

    raw: jsonb('raw').notNull(),

    // Behind-the-scenes popularity counter, incremented when a user taps
    // through to this event. Preserved across re-ingestions (not in the
    // upsert SET clause).
    clickCount: integer('click_count').notNull().default(0),

    // When true, this row was edited by an admin (or via an approved
    // organizer draft) and re-ingestion should NOT overwrite its fields.
    // Enforced in the ingestion upsert via a WHERE clause on conflict.
    manualOverride: boolean('manual_override').notNull().default(false),

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

/**
 * Stripe-backed subscriptions. One row per Stripe subscription. The same
 * user could in principle have multiple kinds (e.g. consumer_no_ads +
 * organizer_pro) — we key on stripe_subscription_id, not (user, kind).
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // 'consumer_no_ads' | 'organizer_pro' (future)
    kind: text('kind').notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id').unique(),
    // 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid'
    status: text('status').notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userKindIdx: index('subscriptions_user_kind_idx').on(t.userId, t.kind, t.status),
  }),
);

/**
 * Magic-link authenticated users. Auth tokens are stateless HMAC-signed,
 * so we don't need a tokens/sessions table — just a record of who's signed
 * in.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    name: text('name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
);

/**
 * "Submit your event" form submissions from organizers. Admin reviews
 * (via CLI for now) and either adds them as a proper source/activity or
 * rejects with a note.
 */
export const contactSubmissions = pgTable(
  'contact_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name'),
    email: text('email').notNull(),
    organization: text('organization'),
    message: text('message').notNull(),
    eventUrl: text('event_url'),
    ipAddress: text('ip_address'),
    // 'new' | 'replied' | 'added' | 'rejected'
    status: text('status').notNull().default('new'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('contact_submissions_status_idx').on(t.status, t.createdAt),
  }),
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type CategoryClick = typeof categoryClicks.$inferSelect;
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;
export type ContactSubmission = typeof contactSubmissions.$inferSelect;
export type NewContactSubmission = typeof contactSubmissions.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

/**
 * "I am the organizer at X" — a claim by a user to be the authoritative
 * holder of a particular organizer_key. Admin approves. Once approved,
 * the user can subscribe to organizer_pro and their events get featured
 * placement.
 */
export const organizerClaims = pgTable(
  'organizer_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizerKey: text('organizer_key').notNull(),
    organizerName: text('organizer_name'), // snapshot at claim time
    note: text('note'),                     // claimant's evidence/justification
    // 'pending' | 'approved' | 'rejected'
    status: text('status').notNull().default('pending'),
    moderatorNote: text('moderator_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    userOrgUnique: uniqueIndex('organizer_claims_user_org_unique').on(t.userId, t.organizerKey),
    statusIdx: index('organizer_claims_status_idx').on(t.status, t.createdAt),
  }),
);

export type OrganizerClaim = typeof organizerClaims.$inferSelect;
export type NewOrganizerClaim = typeof organizerClaims.$inferInsert;

/**
 * Pending event submission or edit from a claimed organizer. Drafts are
 * not visible publicly — admin reviews and approves, at which point the
 * draft is applied to the activities table (insert for activityId=null,
 * update otherwise). Approved updates set manual_override=true on the
 * activity so re-ingestion of scraped sources won't clobber them.
 */
export const eventDrafts = pgTable(
  'event_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // The organizer this draft is for — must match an approved claim
    // belonging to userId at submit time.
    organizerKey: text('organizer_key').notNull(),
    // null = new event submission; set = proposed edit to existing event.
    activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'cascade' }),

    title: text('title'),
    description: text('description'),
    startAt: timestamp('start_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    timezone: text('timezone'),
    venueName: text('venue_name'),
    address: text('address'),
    city: text('city'),
    region: text('region'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    ageMin: integer('age_min'),
    ageMax: integer('age_max'),
    costMinCents: integer('cost_min_cents'),
    costMaxCents: integer('cost_max_cents'),
    currency: text('currency'),
    availability: text('availability'),
    organizerName: text('organizer_name'),
    organizerUrl: text('organizer_url'),
    url: text('url'),
    imageUrl: text('image_url'),
    categories: text('categories').array(),

    // 'pending' | 'approved' | 'rejected'
    status: text('status').notNull().default('pending'),
    moderatorNote: text('moderator_note'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('event_drafts_status_idx').on(t.status, t.createdAt),
    userStatusIdx: index('event_drafts_user_status_idx').on(t.userId, t.status),
    activityIdx: index('event_drafts_activity_idx').on(t.activityId),
  }),
);

export type EventDraft = typeof eventDrafts.$inferSelect;
export type NewEventDraft = typeof eventDrafts.$inferInsert;
