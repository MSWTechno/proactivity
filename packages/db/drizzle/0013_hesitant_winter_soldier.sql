ALTER TABLE "contact_submissions" ADD COLUMN "event_data" jsonb;--> statement-breakpoint
ALTER TABLE "contact_submissions" ADD COLUMN "wants_org_claim" boolean DEFAULT false NOT NULL;