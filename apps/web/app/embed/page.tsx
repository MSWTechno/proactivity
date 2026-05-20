import EmbedView from './EmbedView';

export const dynamic = 'force-dynamic';
// No layout — the embed page renders in a partner-site iframe and must be
// self-contained (no header, no fonts that conflict with the partner).
// This route opts out of the root layout via its own layout.tsx.

export default function EmbedPage() {
  // Everything is client-side: read query params from window.location,
  // fetch /api/public/events with the key the partner embedded, render,
  // and post height to parent for auto-resize.
  return <EmbedView />;
}
