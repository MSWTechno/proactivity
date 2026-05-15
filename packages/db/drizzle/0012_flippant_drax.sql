CREATE TABLE IF NOT EXISTS "url_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organizer_key" text,
	"url" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"moderator_note" text,
	"imported_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "url_submissions" ADD CONSTRAINT "url_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "url_submissions_status_idx" ON "url_submissions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "url_submissions_user_idx" ON "url_submissions" USING btree ("user_id","created_at");