/**
 * Derive a stable organizer key shared across sources.
 * Preferred: URL-based key (host + path, no trailing slash, lowercased).
 *   e.g. "https://www.eventbrite.com/o/the-little-grill-101542741181"
 *     → "eventbrite.com/o/the-little-grill-101542741181"
 *
 * Fallback: name slug.
 *   e.g. "The Little Grill" → "name:the-little-grill"
 */
export function deriveOrganizerKey(name?: string | null, url?: string | null): string | null {
  if (url) {
    try {
      const u = new URL(url);
      const host = u.host.replace(/^www\./i, '');
      const path = u.pathname.replace(/\/+$/, '');
      const key = `${host}${path}`.toLowerCase();
      if (key.length > 0) return key.slice(0, 200);
    } catch {
      /* fall through */
    }
  }
  if (name) {
    const slug = name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (slug.length > 0) return `name:${slug}`.slice(0, 200);
  }
  return null;
}
