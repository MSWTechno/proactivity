CREATE TABLE IF NOT EXISTS "venue_geocodes" (
	"normalized_address" text PRIMARY KEY NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
