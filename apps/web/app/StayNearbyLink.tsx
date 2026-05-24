/**
 * "Stay nearby" affiliate card rendered on city landing pages.
 *
 * The href is a plain Vrbo search URL; the sitewide CJ Deep Link
 * Automation script (loaded from layout.tsx when NEXT_PUBLIC_CJ_PUBLISHER_ID
 * is set) rewrites it to a CJ tracking URL at click time. So we don't
 * hand-stitch tracking params here — the script handles attribution.
 *
 * Hidden when:
 *  - `hidden` prop is true (caller passes true for Plus subscribers).
 *    City pages are server components without easy access to subscription
 *    state today, so callers default to false; revisit when Plus ships.
 */
interface StayNearbyLinkProps {
  city: string;
  region: string;
  hidden?: boolean;
}

export function StayNearbyLink({ city, region, hidden }: StayNearbyLinkProps) {
  if (hidden) return null;

  const destination = encodeURIComponent(`${city}, ${region}, United States of America`);
  const href = `https://www.vrbo.com/search?destination=${destination}&sort=RECOMMENDED`;

  return (
    <aside
      style={{
        marginTop: 32,
        padding: '16px 18px',
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--bg-subtle, #f8f8fb)',
        fontSize: 14,
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>Coming from out of town?</p>
      <p style={{ margin: '4px 0 10px', color: 'var(--fg-muted)' }}>
        Find a place to stay near {city} on Vrbo — vacation rentals from cabins to lakefront homes.
      </p>
      <a
        href={href}
        target="_blank"
        rel="nofollow sponsored noopener"
        className="card-tag"
        style={{ textDecoration: 'none', display: 'inline-block' }}
      >
        Search Vrbo rentals near {city} →
      </a>
      <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--fg-muted)' }}>
        Affiliate link — we may earn a small commission if you book, at no extra cost to you.
      </p>
    </aside>
  );
}
