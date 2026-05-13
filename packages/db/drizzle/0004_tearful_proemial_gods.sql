ALTER TABLE "ratings" ALTER COLUMN "source_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "organizer_name" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "organizer_url" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "organizer_key" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_organizer_key_idx" ON "activities" USING btree ("organizer_key");