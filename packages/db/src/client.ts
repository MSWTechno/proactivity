import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

// Lazy initialization: don't throw at module load if DATABASE_URL is missing.
// Throw on first actual use instead. This keeps build-time module evaluation
// (Next.js "collecting page data") working even without env vars present.

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

// Neon scales the compute to zero only when no client connections are open.
// postgres-js defaults to idle_timeout: null — it holds sockets open forever,
// so every warm Vercel instance pinned the compute awake and we paid for
// compute hours around the clock. Closing idle connections is what actually
// lets autosuspend fire; the reconnect cost on the next request is far
// cheaper than a permanently-running compute.
//
// max_lifetime also recycles long-lived sockets so a single warm instance
// can't hold one connection open indefinitely by staying just busy enough.
const IDLE_TIMEOUT_S = 20;
const MAX_LIFETIME_S = 60 * 30;

// Pool size per process. The nightly ingest runs 4 sources concurrently
// (see runner.ts DEFAULT_CONCURRENCY), so keep enough headroom that workers
// aren't serialising on connections — but well below postgres-js's default
// of 10, which multiplied across warm serverless instances.
const DEFAULT_POOL_MAX = 5;

function poolMax(): number {
  const raw = process.env.DB_POOL_MAX;
  if (!raw) return DEFAULT_POOL_MAX;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 20) return DEFAULT_POOL_MAX;
  return n;
}

function getClient(): ReturnType<typeof postgres> {
  if (_client) return _client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  _client = postgres(url, {
    prepare: false,
    idle_timeout: IDLE_TIMEOUT_S,
    max_lifetime: MAX_LIFETIME_S,
    max: poolMax(),
  });
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
  get(_target, prop) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const val = client[prop];
    // Bind methods to the underlying client so internals (e.g. begin's
    // transaction wiring) see the real connection as `this`, not the Proxy.
    return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(client) : val;
  },
});

export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as unknown as object, prop, receiver);
  },
});

export type DB = Db;
