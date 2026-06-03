/**
 * "Stay nearby" affiliate card rendered on city landing pages.
 *
 * The CJ affiliate link is built SERVER-SIDE here as a static CJ deep-link URL
 * (no client-side redirect script). We used to rely on CJ's "Deep Link
 * Automation" JavaScript to rewrite a plain Vrbo URL at click time, but that
 * client-side redirector tripped URL-reputation engines (e.g. Fortinet
 * "JS/Redirector") and contributed to false-positive malicious blacklistings.
 * Building the tracking URL up front means there is no redirecting JS anywhere
 * on the site.
 *
 * CJ manual deep-link format:
 *   https://www.anrdoezrs.net/links/{WEBSITE_ID}/type/dlg/sid/{SID}/{ENCODED_DEST}
 * Requires deep-linking enabled for the advertiser (Vrbo) on the CJ account —
 * which it already was, since the automation script was deep-linking Vrbo.
 * VERIFY a rendered link redirects to Vrbo AND records a click in the CJ
 * dashboard; if not, adjust the template/sid below (one line).
 *
 * Falls back to the plain Vrbo URL when NEXT_PUBLIC_CJ_PUBLISHER_ID is unset.
 *
 * Hidden when:
 *  - `hidden` prop is true (caller passes true for Plus subscribers).
 *    City pages are server components without easy access to subscription
 *    state today, so callers default to false; revisit when Plus ships.
 */
const CJ_WEBSITE_ID = process.env.NEXT_PUBLIC_CJ_PUBLISHER_ID;

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
  const vrboUrl = `https://www.vrbo.com/search?destination=${destination}&sort=RECOMMENDED`;
  // Server-built CJ deep link (tracked) when configured; plain Vrbo URL otherwise.
  const href = CJ_WEBSITE_ID
    ? `https://www.anrdoezrs.net/links/${CJ_WEBSITE_ID}/type/dlg/sid/stay-nearby/${encodeURIComponent(vrboUrl)}`
    : vrboUrl;

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
    </aside>
  );
}
