CREATE TABLE IF NOT EXISTS "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_key" text NOT NULL,
	"submitter_name" text,
	"submitter_email" text,
	"submitter_ip" text,
	"score" integer NOT NULL,
	"review" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"moderated_at" timestamp with time zone,
	"moderator_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ratings" ADD CONSTRAINT "ratings_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ratings_target_idx" ON "ratings" USING btree ("target_kind","target_key","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ratings_status_idx" ON "ratings" USING btree ("status","created_at");