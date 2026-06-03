import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
// CJ Deep Link Automation — rewrites plain advertiser URLs (vrbo.com,
// expedia.com, etc.) to CJ tracking URLs at click time. One PID per
// registered CJ "Web Site"; set in Vercel envs, not committed.
const CJ_PUBLISHER_ID = process.env.NEXT_PUBLIC_CJ_PUBLISHER_ID;

export const metadata: Metadata = {
  title: 'Proactivity',
  description: 'Things to do near you in the next week.',
  // AdSense site verification + ownership signal — must be in <head>.
  ...(ADSENSE_CLIENT
    ? { other: { 'google-adsense-account': ADSENSE_CLIENT } }
    : {}),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* AdSense expects this script in <head>. Loading async means it
            doesn't block render, but presence in <head> is what AdSense's
            verification crawler looks for. */}
        {ADSENSE_CLIENT && (
          <script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
            crossOrigin="anonymous"
          />
        )}
      </head>
      <body>
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
            </Script>
          </>
        )}
        {CJ_PUBLISHER_ID && (
          <Script
            id="cj-deep-link-automation"
            src={`https://www.anrdoezrs.net/am/${CJ_PUBLISHER_ID}/include/allCj/impressions/page/am.js`}
            strategy="afterInteractive"
          />
        )}
        {GA_ID && CJ_PUBLISHER_ID && (
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
        {children}
        {/* Vercel Web Analytics — privacy-friendly traffic + page views,
            complements GA and gives server-aware visibility. Enable it in the
            Vercel project's Analytics tab for data to start flowing. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
