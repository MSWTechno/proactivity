/**
 * SEO landing-page window definitions. Each window represents a slice
 * of the events catalog targeted at a specific long-tail search query
 * ("things to do harrisonburg this weekend", "free events lake anna",
 * etc.). Adding a new window here automatically gets it included in
 * the sitemap and routed under /things-to-do/[city]/[window].
 *
 * Two flavours:
 *  - 'time' windows narrow by date range (this weekend, today, tonight)
 *  - 'category' windows narrow by canonical category or availability
 *
 * Both produce: a slug, a human title fragment, a meta description
 * template, and a SQL fragment that the page renders.
 */
import { sql } from '@proactivity/db';

// postgres.js doesn't export a stable fragment type — `sql\`...\`` returns
// either a PendingQuery (when awaited) or a Helper (when composed). We
// just need "whatever the tagged template returns" here.
type SqlFragment = ReturnType<typeof sql>;

export type WindowKind = 'time' | 'category';

export interface WindowDef {
  slug: string;
  kind: WindowKind;
  /** Used in <title> and H1 — e.g. "This Weekend", "Free", "for Families". */
  label: string;
  /** Inserted into meta description sentences. */
  metaPhrase: string;
  /**
   * Build the SQL filter chunk appended to the WHERE clause. Receives
   * `now` so callers can compute the same window the page is rendering
   * against. Empty fragment = no extra filter.
   */
  buildFilter(now: Date): SqlFragment;
  /** Optional override for max events to show on the page. */
  limit?: number;
}

function isoDate(d: Date): string {
  return d.toISOString();
}

/**
 * Resolve "this weekend" as Fri 00:00 → Mon 00:00 of the current week
 * if today is Mon-Thu, else the next Fri/Sat/Sun if today is already in
 * or past the weekend. Always returns a future-leaning 3-day span so the
 * page never renders empty on Sundays.
 */
function thisWeekendRange(now: Date): { from: Date; to: Date } {
  const day = now.getDay(); // 0=Sun, 5=Fri, 6=Sat
  let daysToFri: number;
  if (day >= 1 && day <= 5) daysToFri = 5 - day;
  else if (day === 6) daysToFri = 0;
  else /* day === 0 */ daysToFri = 5;
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  // If we're already on Sat or Sun, start the window from "now" so we
  // don't show events that already happened earlier this Sat.
  if (day === 6 || day === 0) {
    from.setTime(now.getTime());
  } else {
    from.setDate(from.getDate() + daysToFri);
  }
  const to = new Date(from);
  // Sun 23:59:59 = +3 days from Fri 00:00.
  to.setDate(to.getDate() + (3 - (day === 6 ? 1 : day === 0 ? 2 : 0)));
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export const WINDOWS: readonly WindowDef[] = [
  {
    slug: 'this-weekend',
    kind: 'time',
    label: 'This Weekend',
    metaPhrase: 'this weekend',
    buildFilter(now) {
      const { from, to } = thisWeekendRange(now);
      return sql`AND a.start_at >= ${isoDate(from)}::timestamptz AND a.start_at <= ${isoDate(to)}::timestamptz`;
    },
  },
  {
    slug: 'today',
    kind: 'time',
    label: 'Today',
    metaPhrase: 'today',
    buildFilter(now) {
      return sql`AND a.start_at >= ${isoDate(now)}::timestamptz AND a.start_at <= ${isoDate(endOfDay(now))}::timestamptz`;
    },
  },
  {
    slug: 'tonight',
    kind: 'time',
    label: 'Tonight',
    metaPhrase: 'tonight',
    buildFilter(now) {
      const cutoff = new Date(now);
      // "Tonight" = events starting after 5pm today.
      if (cutoff.getHours() < 17) cutoff.setHours(17, 0, 0, 0);
      return sql`AND a.start_at >= ${isoDate(cutoff)}::timestamptz AND a.start_at <= ${isoDate(endOfDay(now))}::timestamptz`;
    },
  },
  {
    slug: 'this-week',
    kind: 'time',
    label: 'This Week',
    metaPhrase: 'this week',
    buildFilter(now) {
      return sql`AND a.start_at <= ${isoDate(addDays(now, 7))}::timestamptz`;
    },
  },
  {
    slug: 'free',
    kind: 'category',
    label: 'Free',
    metaPhrase: 'free',
    buildFilter() {
      return sql`AND (a.cost_min_cents = 0 OR a.availability = 'free')`;
    },
  },
  {
    slug: 'family',
    kind: 'category',
    label: 'for Families',
    metaPhrase: 'for families and kids',
    buildFilter() {
      return sql`AND a.categories && ARRAY['family']::text[]`;
    },
  },
  {
    slug: 'outdoor',
    kind: 'category',
    label: 'Outdoor',
    metaPhrase: 'outdoors',
    buildFilter() {
      return sql`AND a.categories && ARRAY['outdoor']::text[]`;
    },
  },
  {
    slug: 'music',
    kind: 'category',
    label: 'Music',
    metaPhrase: 'live music',
    buildFilter() {
      return sql`AND a.categories && ARRAY['music']::text[]`;
    },
  },
];

export function findWindow(slug: string): WindowDef | null {
  return WINDOWS.find((w) => w.slug === slug) ?? null;
}
