import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
// No CJ affiliate JavaScript site-wide (or anywhere): the affiliate tracking
// URL is now built server-side as a static CJ deep link in StayNearbyLink, so
// there's no client-side redirector script that URL-reputation engines flag.

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
