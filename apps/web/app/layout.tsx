import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CookieBanner } from './CookieBanner';

const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;

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
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
