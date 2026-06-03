/**
 * Returns a timezone string safe to pass to `toLocaleString({ timeZone })`.
 *
 * Scraped sources store all sorts of values in the timezone field — valid IANA
 * names ("America/New_York"), valid offset zones ("-04:00"), but also invalid
 * junk like "-5:00" (unpadded) or "Z". Passing an invalid value to
 * Intl/toLocaleString throws a RangeError, which on a client-rendered page
 * crashes the whole render. Validate once and fall back to the app's home zone.
 */
export function safeTimeZone(tz: string | null | undefined): string {
  const candidate = tz && tz.trim() ? tz.trim() : 'America/New_York';
  try {
    // Throws RangeError if the zone is not recognized.
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'America/New_York';
  }
}
