import { CjAffiliateScripts } from './CjAffiliateScripts';

/**
 * "Stay nearby" affiliate card rendered on city landing pages.
 *
 * The href is a plain Vrbo search URL; the CJ Deep Link Automation script
 * (rendered here via <CjAffiliateScripts>, scoped to where affiliate links
 * actually appear) rewrites it to a CJ tracking URL at click time. So we
 * don't hand-stitch tracking params here — the script handles attribution.
 *
 * Hidden when:
 *  - `hidden` prop is true (caller passes true for Plus subscribers).
 *    City pages are server components without easy access to subscription
 *    state today, so callers default to false; revisit when Plus ships.
 */
interface StayNearbyLinkProps {
  city: string;
  /** Optional — when blank, the destination omits the region piece. */
  region?: string;
  hidden?: boolean;
}

export function StayNearbyLink({ city, region, hidden }: StayNearbyLinkProps) {
  if (hidden || !city) return null;

  const destinationText = [city, region, 'United States of America']
    .filter(Boolean)
    .join(', ');
  const destination = encodeURIComponent(destinationText);
  const href = `https://www.vrbo.com/search?destination=${destination}&sort=RECOMMENDED`;

  return (
    <aside
      style={{
        marginTop: 40,
        padding: '20px 22px',
        border: '1px solid var(--accent)',
        borderRadius: 12,
        background: 'var(--accent-soft)',
      }}
    >
      <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--accent-fg)' }}>
        <span aria-hidden="true" style={{ marginRight: 8 }}>🏡</span>
        Coming from out of town?
      </p>
      <p style={{ margin: '6px 0 14px', fontSize: 15, color: 'var(--fg)' }}>
        Find a place to stay near {city} on Vrbo — vacation rentals from cozy cabins
        to lakefront homes, often cheaper than a hotel for groups.
      </p>
      <a
        href={href}
        target="_blank"
        rel="nofollow sponsored noopener"
        style={{
          display: 'inline-block',
          padding: '10px 18px',
          background: 'var(--accent)',
          color: 'white',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 15,
          borderRadius: 'var(--radius, 8px)',
        }}
      >
        Search Vrbo rentals in {city} →
      </a>
      <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--fg-muted)' }}>
        Affiliate link — we may earn a small commission if you book, at no extra cost to you.
      </p>
      {/* CJ scripts load only here, where the affiliate link actually is. */}
      <CjAffiliateScripts />
    </aside>
  );
}
