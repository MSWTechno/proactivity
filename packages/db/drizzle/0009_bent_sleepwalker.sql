CREATE TABLE IF NOT EXISTS "organizer_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organizer_key" text NOT NULL,
	"organizer_name" text,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"moderator_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organizer_claims" ADD CONSTRAINT "organizer_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizer_claims_user_org_unique" ON "organizer_claims" USING btree ("user_id","organizer_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizer_claims_status_idx" ON "organizer_claims" USING btree ("status","created_at");