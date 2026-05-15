/**
 * URL validation. `new URL(s)` happily accepts `javascript:alert(1)`,
 * `data:`, and `file:` schemes — all of which would execute as XSS when
 * rendered into a clickable `<a href={url}>` link. This helper restricts
 * to plain http/https.
 */
export function isSafeHttpUrl(s: string): boolean {
  let parsed: URL;
  try { parsed = new URL(s); } catch { return false; }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}
