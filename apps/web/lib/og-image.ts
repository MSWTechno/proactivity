import { isSafeHttpUrl } from './url';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BYTES = 256 * 1024; // 256KB is enough for <head> on any well-formed page
const USER_AGENT = 'Mozilla/5.0 (compatible; ProactivityBot/1.0; +https://proactivity.app/contact)';

// Order matters — first match wins. We look at og:image first since it's the
// canonical "use this when sharing the page" image, then twitter:image, then
// fall back to a generic <link rel="image_src"> which a few CMSes still emit.
const META_PATTERNS: RegExp[] = [
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
];

/**
 * Best-effort extraction of a representative image URL from an event/page URL.
 * Returns null on any failure (timeout, non-2xx, no meta tags, unsafe URL).
 *
 * Designed to be fire-without-fearing: callers should treat null as the
 * normal "no image" case and never surface fetch errors to the user.
 */
export async function extractOgImage(pageUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string | null> {
  if (!isSafeHttpUrl(pageUrl)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(pageUrl, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.toLowerCase().includes('html')) return null;

    // Read up to MAX_BYTES then bail — we only need the <head>.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let html = '';
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      html += decoder.decode(value, { stream: true });
      // Stop once we've passed </head> — no point reading the body.
      if (/<\/head>/i.test(html)) break;
    }
    try { await reader.cancel(); } catch { /* ignore */ }

    for (const pattern of META_PATTERNS) {
      const m = html.match(pattern);
      const raw = m?.[1]?.trim();
      if (!raw) continue;
      const resolved = resolveAbsolute(raw, res.url || pageUrl);
      if (resolved && isSafeHttpUrl(resolved)) return resolved;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function resolveAbsolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
