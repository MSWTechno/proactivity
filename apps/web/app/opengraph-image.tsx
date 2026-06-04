import { ImageResponse } from 'next/og';

/**
 * The link-preview card Facebook / iMessage / Slack / X show when someone
 * shares proactivity.app. Rendered at the 1200x630 size social platforms
 * expect (1.91:1) so it never gets cropped to a tiny square. Next wires this
 * file up as og:image automatically via the file-based metadata convention.
 *
 * Brand: accent #6d28d9, the circle-with-forward-chevron mark, wordmark, and
 * tagline — matching apps/web/app/Logo.tsx + globals.css.
 */
export const runtime = 'edge';
export const alt = 'Proactivity — things to do near you, this week';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  // Inverted logo (white circle, purple chevron) so it pops on the purple card.
  const logo =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="180" height="180">' +
    '<circle cx="16" cy="16" r="16" fill="#ffffff"/>' +
    '<path d="M12 9 L20 16 L12 23" fill="none" stroke="#6d28d9" stroke-width="3.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #6d28d9 0%, #4c1d95 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          width="180"
          height="180"
          src={`data:image/svg+xml;utf8,${encodeURIComponent(logo)}`}
          alt=""
        />
        <div style={{ fontSize: 104, fontWeight: 700, marginTop: 28, letterSpacing: '-0.03em' }}>
          proactivity
        </div>
        <div style={{ fontSize: 42, marginTop: 6, opacity: 0.92 }}>
          Things to do near you, this week.
        </div>
      </div>
    ),
    { ...size },
  );
}
