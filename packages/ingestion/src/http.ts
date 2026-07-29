/**
 * Polite HTTP for adapters.
 *
 * The problem this solves: the runner fans out across N sources concurrently
 * (INGEST_CONCURRENCY, default 4), and many sources share a host. With 32
 * Eventbrite metro sources in the queue, four workers would hit
 * eventbrite.com simultaneously — each with only an intra-source delay — and
 * the host rate-limited us. Every Eventbrite source after the ban failed on
 * its very first request with `429 Too Many Requests` (16 of 32 on the
 * 2026-07-18 run, all failing within ~80ms of each other).
 *
 * Three mechanisms, all keyed by host so unrelated sources still run in
 * parallel:
 *   1. A per-host lock that serializes requests and enforces a minimum
 *      interval (plus jitter) between them, ACROSS concurrent workers.
 *   2. Retry on 429/503 with exponential backoff, honoring `Retry-After`.
 *   3. A per-host circuit breaker: once a host has hard-refused us
 *      `cooldownAfter` times in a row, fail fast for the rest of the run
 *      instead of burning the cron's wallclock budget requeueing into a ban.
 *
 * State is module-level, so it lives for the lifetime of the process (one
 * cron invocation). That is exactly the scope we want — a fresh invocation
 * should start with a clean slate and re-probe the host.
 */

export interface HostPolicy {
  /** Minimum gap between two requests to this host, before jitter. */
  minIntervalMs: number;
  /** Retries for a retryable status (429/503) before giving up. */
  maxRetries: number;
  /** Consecutive give-ups before the host is put in cooldown. */
  cooldownAfter: number;
  /** How long the circuit stays open once tripped. */
  cooldownMs: number;
  /** Never honor a Retry-After longer than this — the cron has a deadline. */
  maxBackoffMs: number;
}

const DEFAULT_POLICY: HostPolicy = {
  minIntervalMs: 250,
  maxRetries: 2,
  cooldownAfter: 4,
  cooldownMs: 10 * 60_000,
  maxBackoffMs: 20_000,
};

// Most-specific match wins; first hit is used.
const HOST_POLICIES: Array<[RegExp, Partial<HostPolicy>]> = [
  // Eventbrite is the one that actually banned us. Deliberately slow: their
  // ToS discourages broad scraping, so err toward under-asking.
  [/(^|\.)eventbrite\.com$/, { minIntervalMs: 900, maxRetries: 3, cooldownAfter: 3 }],
  [/(^|\.)meetup\.com$/, { minIntervalMs: 500 }],
];

function policyFor(host: string): HostPolicy {
  for (const [pattern, overrides] of HOST_POLICIES) {
    if (pattern.test(host)) return { ...DEFAULT_POLICY, ...overrides };
  }
  return DEFAULT_POLICY;
}

interface HostState {
  /** Serializes all in-flight requests to this host. */
  chain: Promise<void>;
  lastRequestAt: number;
  consecutiveRefusals: number;
  cooldownUntil: number;
}

const hostState = new Map<string, HostState>();

function stateFor(host: string): HostState {
  let s = hostState.get(host);
  if (!s) {
    s = { chain: Promise.resolve(), lastRequestAt: 0, consecutiveRefusals: 0, cooldownUntil: 0 };
    hostState.set(host, s);
  }
  return s;
}

/** Thrown when a host's circuit breaker is open. Distinguishable for callers. */
export class HostCooldownError extends Error {
  readonly host: string;
  constructor(host: string, until: number) {
    const secs = Math.ceil((until - Date.now()) / 1000);
    super(`${host} is in cooldown after repeated rate-limiting (~${secs}s left)`);
    this.name = 'HostCooldownError';
    this.host = host;
  }
}

const RETRYABLE_STATUS = new Set([429, 503]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

/**
 * `Retry-After` is either delta-seconds or an HTTP date. Returns null when
 * absent or unparseable so the caller falls back to exponential backoff.
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const when = Date.parse(value);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

/** Run `fn` with exclusive access to `host`, preserving FIFO order. */
function withHostLock<T>(state: HostState, fn: () => Promise<T>): Promise<T> {
  // Chain onto the previous request regardless of whether it settled ok — a
  // failure must not break the queue for everyone behind it.
  const result = state.chain.then(fn, fn);
  state.chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export interface ThrottledFetchInit {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Host-throttled fetch with rate-limit backoff. Resolves to the Response for
 * any non-retryable status (including 4xx/5xx — callers check `res.ok`);
 * throws HostCooldownError when the host's breaker is open, or a plain Error
 * once retries are exhausted.
 */
export async function throttledFetch(url: string, init: ThrottledFetchInit = {}): Promise<Response> {
  const host = new URL(url).host;
  const policy = policyFor(host);
  const state = stateFor(host);

  // Check the breaker before queueing — no point waiting for a lock on a host
  // we already know is refusing us.
  if (state.cooldownUntil > Date.now()) throw new HostCooldownError(host, state.cooldownUntil);

  return withHostLock(state, async () => {
    // Re-check: the breaker may have tripped while we waited our turn.
    if (state.cooldownUntil > Date.now()) throw new HostCooldownError(host, state.cooldownUntil);

    for (let attempt = 0; ; attempt++) {
      const sinceLast = Date.now() - state.lastRequestAt;
      // Jitter by ±20% so we don't emit a perfectly periodic signature.
      const jittered = policy.minIntervalMs * (0.8 + Math.random() * 0.4);
      if (sinceLast < jittered) await sleep(jittered - sinceLast, init.signal);

      state.lastRequestAt = Date.now();
      const res = await fetch(url, { headers: init.headers, signal: init.signal });

      if (!RETRYABLE_STATUS.has(res.status)) {
        state.consecutiveRefusals = 0;
        return res;
      }

      // Drain the body so the socket can be reused rather than left hanging.
      await res.arrayBuffer().catch(() => undefined);

      if (attempt >= policy.maxRetries) {
        state.consecutiveRefusals++;
        if (state.consecutiveRefusals >= policy.cooldownAfter) {
          state.cooldownUntil = Date.now() + policy.cooldownMs;
          console.warn(
            `[http] ${host} refused ${state.consecutiveRefusals}x in a row — ` +
              `circuit open for ${Math.round(policy.cooldownMs / 1000)}s`,
          );
        }
        throw new Error(`${res.status} ${res.statusText}`);
      }

      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      const backoff = Math.min(
        retryAfter ?? policy.minIntervalMs * 2 ** (attempt + 1),
        policy.maxBackoffMs,
      );
      console.warn(`[http] ${res.status} from ${host}, retrying in ${Math.round(backoff)}ms`);
      await sleep(backoff, init.signal);
    }
  });
}

/** Convenience wrapper: throttled fetch that throws on non-2xx and returns text. */
export async function throttledFetchText(url: string, init: ThrottledFetchInit = {}): Promise<string> {
  const res = await throttledFetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

/** Test/ops helper — clears breaker + pacing state. */
export function resetHostState(): void {
  hostState.clear();
}
