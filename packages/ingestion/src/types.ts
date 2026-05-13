/**
 * The canonical shape every adapter produces. Adapters do all source-specific
 * mapping; the runner only sees this.
 */
export interface NormalizedActivity {
  sourceEventId: string;
  title: string;
  description?: string | null;
  startAt: Date;
  endAt?: Date | null;
  timezone?: string | null;
  venueName?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  location?: { lng: number; lat: number } | null;
  ageMin?: number | null;
  ageMax?: number | null;
  costMinCents?: number | null;
  costMaxCents?: number | null;
  currency?: string | null;
  /**
   * Last-minute-attendability signal. Adapters MUST classify:
   *  - 'onsale'    : ticket still buyable
   *  - 'free'      : free, no ticket required (e.g. parks/rec)
   *  - 'dropin'    : walk-up welcome (e.g. open studios)
   *  - 'sold_out'  : ticket required but unavailable
   *  - 'cancelled' : event cancelled
   *  - 'unknown'   : adapter couldn't determine
   */
  availability: 'onsale' | 'free' | 'dropin' | 'sold_out' | 'cancelled' | 'unknown';
  /**
   * True when the source explicitly marks this event as virtual/online
   * (e.g. JSON-LD eventAttendanceMode: OnlineEventAttendanceMode).
   * The API filter excludes these by default.
   */
  isVirtual?: boolean;
  /**
   * Organizer / host identity. Adapters extract these when available;
   * the runner derives organizerKey from URL slug (preferred) or name
   * slug if not explicitly set.
   */
  organizerName?: string | null;
  organizerUrl?: string | null;
  organizerKey?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  categories?: string[] | null;
  /** Original payload for debugging / re-normalization. */
  raw: unknown;
}

export interface FetchContext {
  /** Raw config from sources.config jsonb. Adapter validates its own shape. */
  config: Record<string, unknown>;
  /** Soft signal — adapters should stop iterating when called. */
  signal?: AbortSignal;
}

export type ParseConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: string };

export interface SourceAdapter {
  /** Stable key used in sources.adapter_key. */
  readonly key: string;
  /**
   * Human-readable usage string for the CLI, e.g. "<lat> <lng> [radiusKm]".
   * Shown in `pnpm sources:add` help output.
   */
  readonly configHelp: string;
  /**
   * Validate and shape positional CLI args into the jsonb stored in
   * sources.config. Adapters own their own config schema.
   */
  parseCliConfig(args: string[]): ParseConfigResult;
  /** Stream activities; runner consumes incrementally to avoid buffering. */
  fetch(ctx: FetchContext): AsyncIterable<NormalizedActivity>;
}
