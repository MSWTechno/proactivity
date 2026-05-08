CREATE TABLE IF NOT EXISTS "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_event_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"timezone" text,
	"venue_name" text,
	"address" text,
	"city" text,
	"region" text,
	"country" text,
	"location" geometry(point),
	"age_min" integer,
	"age_max" integer,
	"cost_min_cents" integer,
	"cost_max_cents" integer,
	"currency" text DEFAULT 'USD',
	"availability" text DEFAULT 'unknown' NOT NULL,
	"url" text,
	"image_url" text,
	"categories" text[],
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adapter_key" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activities_source_event_unique" ON "activities" USING btree ("source_id","source_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_start_at_idx" ON "activities" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_location_idx" ON "activities" USING gist ("location");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_availability_idx" ON "activities" USING btree ("availability");