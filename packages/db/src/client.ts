import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

// Lazy initialization: don't throw at module load if DATABASE_URL is missing.
// Throw on first actual use instead. This keeps build-time module evaluation
// (Next.js "collecting page data") working even without env vars present.

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getClient(): ReturnType<typeof postgres> {
  if (_client) return _client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  _client = postgres(url, { prepare: false });
  return _client;
}

function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;
  _db = drizzle(getClient(), { schema });
  return _db;
}

// Preserve the original API (`sql\`...\``, `sql.end()`, `db.select()...`)
// via Proxies that defer initialization to first access.

type Sql = ReturnType<typeof postgres>;
type Db = ReturnType<typeof drizzle<typeof schema>>;

export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  apply(_target, thisArg, args) {
    return Reflect.apply(getClient() as unknown as (...a: unknown[]) => unknown, thisArg, args);
  },
  get(_target, prop, receiver) {
    const client = getClient() as unknown as object;
    return Reflect.get(client, prop, receiver);
  },
});

export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as unknown as object, prop, receiver);
  },
});

export type DB = Db;
