import Script from 'next/script';

/**
 * CJ Affiliate scripts, scoped to pages that actually render affiliate links
 * (i.e. <StayNearbyLink>). Previously these lived in the root layout and loaded
 * site-wide — but the CJ Deep Link Automation script loads from a CJ redirect
 * domain (anrdoezrs.net) that URL-reputation engines associate with affiliate
 * cloaking, which contributed to false-positive "malicious" blacklistings.
 * Loading them only where an affiliate link exists keeps the redirect-domain
 * footprint off the rest of the site.
 *
 * - CJ Deep Link Automation rewrites plain advertiser URLs (vrbo.com, etc.) to
 *   CJ tracking URLs at click time.
 * - The click tracker fires a GA `affiliate_click` event.
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const CJ_PUBLISHER_ID = process.env.NEXT_PUBLIC_CJ_PUBLISHER_ID;

export function CjAffiliateScripts() {
  if (!CJ_PUBLISHER_ID) return null;
  return (
    <>
      <Script
        id="cj-deep-link-automation"
        src={`https://www.anrdoezrs.net/am/${CJ_PUBLISHER_ID}/include/allCj/impressions/page/am.js`}
        strategy="afterInteractive"
      />
      {GA_ID && (
        <Script id="affiliate-click-tracker" strategy="afterInteractive">
          {`document.addEventListener('click', function(e) {
  var a = e.target && e.target.closest && e.target.closest('a');
  if (!a) return;
  var href = a.getAttribute('href') || '';
  if (/vrbo\\.com|expedia\\.com|anrdoezrs\\.net|jdoqocy\\.com|tkqlhce\\.com|kqzyfj\\.com|qksrv\\.net|dpbolvw\\.net|awltovhc\\.com/i.test(href)) {
    var domain = '';
    try { domain = new URL(href, window.location.href).hostname; } catch (_) {}
    if (typeof gtag === 'function') {
      gtag('event', 'affiliate_click', {
        affiliate_url: href,
        affiliate_domain: domain,
        link_text: (a.textContent || '').trim().substring(0, 80),
        page_path: window.location.pathname,
      });
    }
  }
});`}
        </Script>
      )}
    </>
  );
}
