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
 * "Submit your event" form submissions from organizers, and general
 * "Contact us" inquiries. Admin reviews in /admin/moderate and either
 * adds them as a proper activity (via "Add as event") or rejects.
 *
 * When the submission came from the structured event form, `event_data`
 * holds the typed fields (title, start, venue, etc.) so the admin's
 * "Add as event" flow can prefill the activity form fully — not just
 * the title/description. Older submissions have event_data=null and
 * fall back to message text.
 *
 * `wants_org_claim` is set when the submitter checked "Claim this
 * organization with my email" on the public form. The claim is only
 * actually created when the admin approves the event in /admin/events/new
 * (atomic with the activity insert) — so rejected events don't leave
 * orphan claims in the queue.
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
    eventData: jsonb('event_data'),
    wantsOrgClaim: boolean('wants_org_claim').notNull().default(false),
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

    // Recurrence (only used for new-event drafts; ignored for edits).
    // 'weekly' | 'biweekly' | 'monthly'
    recurrenceFreq: text('recurrence_freq'),
    recurrenceCount: integer('recurrence_count'),
    // ISO YYYY-MM-DD dates to skip (e.g., holidays the org is closed).
    recurrenceSkipDates: text('recurrence_skip_dates').array(),

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

/**
 * URLs an organizer wants admin to scrape for events. Admin runs the import
 * out-of-band (manual queue), then marks the row as 'imported' (with a
 * count) or 'rejected' (with a note). organizerKey is optional — useful for
 * routing newly-imported activities to an existing claim, but a user can
 * submit a URL without naming an org.
 */
export const urlSubmissions = pgTable(
  'url_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizerKey: text('organizer_key'),
    url: text('url').notNull(),
    note: text('note'),
    // 'pending' | 'imported' | 'rejected' | 'failed'
    status: text('status').notNull().default('pending'),
    moderatorNote: text('moderator_note'),
    importedCount: integer('imported_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('url_submissions_status_idx').on(t.status, t.createdAt),
    userIdx: index('url_submissions_user_idx').on(t.userId, t.createdAt),
  }),
);

export type UrlSubmission = typeof urlSubmissions.$inferSelect;
export type NewUrlSubmission = typeof urlSubmissions.$inferInsert;

/**
 * Partner / external-site API keys for the public events feed
 * (GET /api/public/events). Plaintext key is never stored — only a
 * SHA-256 hash. `prefix` is the first 8 chars of the plaintext key
 * (e.g. "pa_2a1f3c") so admins can identify keys in lists without
 * exposing the secret. Keys are revoked by setting `active=false`,
 * not deleted, so audit history survives.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    keyHash: text('key_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    label: text('label').notNull(),
    ownerEmail: text('owner_email'),
    /** null = unlimited daily quota */
    dailyQuota: integer('daily_quota'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    activeIdx: index('api_keys_active_idx').on(t.active, t.createdAt),
  }),
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

/**
 * "I want Proactivity in my area" requests from public visitors. Two
 * goals: (1) signal which regions to expand into next, (2) capture a
 * soft commitment to seed events so we filter for serious bootstrappers.
 *
 * Admin reviews in /admin/area-requests, clusters geographically, and
 * marks `launched` once sources + presets have been configured for that
 * region. The submitter then gets a magic-link follow-up.
 */
export const areaRequests = pgTable(
  'area_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name'),
    /** Free text the visitor typed, e.g. "Charlottesville, VA" */
    regionText: text('region_text').notNull(),
    /** From browser geolocation if granted — null otherwise */
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    /** 'resident' | 'organizer' | 'attendee' (free text in case future options) */
    relationship: text('relationship'),
    /** Number of events they pledged to add in the first month */
    committedEventCount: integer('committed_event_count'),
    ipAddress: text('ip_address'),
    /** 'requested' | 'launched' | 'rejected' */
    status: text('status').notNull().default('requested'),
    moderatorNote: text('moderator_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('area_requests_status_idx').on(t.status, t.createdAt),
  }),
);

export type AreaRequest = typeof areaRequests.$inferSelect;
export type NewAreaRequest = typeof areaRequests.$inferInsert;
