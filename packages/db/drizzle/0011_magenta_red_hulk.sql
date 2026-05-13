ALTER TABLE "event_drafts" ADD COLUMN "recurrence_freq" text;--> statement-breakpoint
ALTER TABLE "event_drafts" ADD COLUMN "recurrence_count" integer;--> statement-breakpoint
ALTER TABLE "event_drafts" ADD COLUMN "recurrence_skip_dates" text[];