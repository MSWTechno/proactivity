/**
 * Shared recurrence expansion used by:
 *  - server: organizer-draft approval (inserts N rows)
 *  - client: organizer form preview (shows dates as user types)
 *  - client: admin moderation card (shows dates before approval)
 */

export type RecurrenceFreq = 'weekly' | 'biweekly' | 'monthly';

export interface Occurrence {
  start: Date;
  end: Date | null;
  /** YYYY-MM-DD in the event's local timezone — what skipDates match against. */
  dateKey: string;
}

const DEFAULT_TZ = 'America/New_York';

/**
 * Compute the YYYY-MM-DD calendar date of `d` in the given IANA timezone.
 * Skip-date matching uses this so "skip 2026-07-04" matches an evening-ET
 * event whose UTC instant falls on 2026-07-05.
 */
export function localDateKey(d: Date, timezone: string = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/**
 * Add `n` months to `d`, clamping day-of-month so overflow doesn't roll into
 * the next month (Jan 31 + 1 month → Feb 28/29, not Mar 3).
 */
function addMonthsClamped(d: Date, n: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDay);
  return new Date(Date.UTC(
    year, month, day,
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds(),
  ));
}

/**
 * Expand a recurrence rule into ordered occurrences. For non-recurring
 * (freq/count missing or count < 2), returns the original event as the
 * single occurrence.
 *
 * Caveat: weekly/biweekly use millisecond arithmetic, so the local clock
 * time can drift by one hour across DST transitions. The calendar date is
 * still correct.
 */
export function generateOccurrences(
  firstStart: Date,
  firstEnd: Date | null,
  freq: string | null,
  count: number | null,
  skipDates: string[] | null,
  timezone: string = DEFAULT_TZ,
): Occurrence[] {
  if (!freq || !count || count < 2 || !isFreq(freq)) {
    return [{ start: firstStart, end: firstEnd, dateKey: localDateKey(firstStart, timezone) }];
  }
  const durationMs = firstEnd ? firstEnd.getTime() - firstStart.getTime() : null;
  const skip = new Set(skipDates ?? []);
  const out: Occurrence[] = [];
  for (let i = 0; i < count; i++) {
    const start = freq === 'monthly'
      ? addMonthsClamped(firstStart, i)
      : new Date(firstStart.getTime() + i * (freq === 'biweekly' ? 14 : 7) * 86400000);
    const dateKey = localDateKey(start, timezone);
    if (skip.has(dateKey)) continue;
    const end = durationMs != null ? new Date(start.getTime() + durationMs) : null;
    out.push({ start, end, dateKey });
  }
  return out;
}

function isFreq(s: string): s is RecurrenceFreq {
  return s === 'weekly' || s === 'biweekly' || s === 'monthly';
}

export function describeRecurrence(freq: string, count: number, skipCount = 0): string {
  const freqLabel = freq === 'biweekly' ? 'every 2 weeks' : freq;
  const skipSuffix = skipCount > 0 ? ` (skip ${skipCount})` : '';
  return `repeats ${freqLabel} × ${count}${skipSuffix}`;
}
