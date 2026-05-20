// Standalone layout for /embed — no header, no global font/CSS imports,
// no nav. The embed renders inside a partner-site iframe and must not
// pull in the main app's CSS that could collide with the partner's
// design system or balloon the iframe payload.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Proactivity embed',
  // Discourage search engines from indexing the iframe URL directly.
  robots: { index: false, follow: false },
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
