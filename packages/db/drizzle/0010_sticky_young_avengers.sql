CREATE TABLE IF NOT EXISTS "event_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organizer_key" text NOT NULL,
	"activity_id" uuid,
	"title" text,
	"description" text,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"timezone" text,
	"venue_name" text,
	"address" text,
	"city" text,
	"region" text,
	"lat" double precision,
	"lng" double precision,
	"age_min" integer,
	"age_max" integer,
	"cost_min_cents" integer,
	"cost_max_cents" integer,
	"currency" text,
	"availability" text,
	"organizer_name" text,
	"organizer_url" text,
	"url" text,
	"image_url" text,
	"categories" text[],
	"status" text DEFAULT 'pending' NOT NULL,
	"moderator_note" text,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "manual_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_drafts" ADD CONSTRAINT "event_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_drafts" ADD CONSTRAINT "event_drafts_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_drafts" ADD CONSTRAINT "event_drafts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_drafts_status_idx" ON "event_drafts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_drafts_user_status_idx" ON "event_drafts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_drafts_activity_idx" ON "event_drafts" USING btree ("activity_id");