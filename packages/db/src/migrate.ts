// Env is loaded via `tsx --env-file=../../.env` (see package.json scripts).
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = postgres(url, { max: 1, prepare: false });

await client.unsafe('CREATE EXTENSION IF NOT EXISTS postgis');

const db = drizzle(client);
await migrate(db, { migrationsFolder: './drizzle' });

await client.end();
console.log('Migrations applied.');
