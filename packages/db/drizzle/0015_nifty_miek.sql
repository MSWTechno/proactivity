CREATE TABLE IF NOT EXISTS "area_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"region_text" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"relationship" text,
	"committed_event_count" integer,
	"ip_address" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"moderator_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "area_requests_status_idx" ON "area_requests" USING btree ("status","created_at");