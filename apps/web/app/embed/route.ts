import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { authenticate } from '@/lib/api-auth';
import { LOCATION_PRESETS, findPreset } from '@/lib/locations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /embed — partner iframe content.
 *
 * Implemented as a route handler (not a Next.js page) so it can return
 * a fully self-contained HTML document — NO root layout, NO global CSS,
 * NO Google Analytics / AdSense, NO Next chunks. Just inline <style>
 * and a small inline <script> for ResizeObserver-based auto-resize.
 *
 * Loaded by /public/embed.js via iframe.src.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  // ----- auth -----
  // Re-use the same authenticate() helper as /api/public/events so a key
  // revoked in /admin/api-keys instantly kills the embed too.
  const auth = await authenticate(request);
  if (!auth.ok) {
    return htmlResponse(errorPage(auth.error));
  }

  // ----- resolve geo -----
  let lat: number;
  let lng: number;
  let presetId: string | undefined;
  const presetParam = url.searchParams.get('location')?.trim() ?? '';
  if (presetParam) {
    const preset = findPreset(presetParam);
    if (!preset) {
      const known = LOCATION_PRESETS.map((p) => p.id).join(', ');
      return htmlResponse(errorPage(`Unknown location "${presetParam}" — try one of: ${known}`));
    }
    lat = preset.lat;
    lng = preset.lng;
    presetId = preset.id;
  } else {
    lat = parseFloat(url.searchParams.get('lat') ?? '');
    lng = parseFloat(url.searchParams.get('lng') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return htmlResponse(errorPage('Embed needs either ?location=<preset> or ?lat=&lng='));
    }
  }

  const radiusMi = clamp(parseInt(url.searchParams.get('radiusMi') ?? '25', 10), 1, 200, 25);
  const days = clamp(parseInt(url.searchParams.get('days') ?? '7', 10), 1, 90, 7);
  const limit = clamp(parseInt(url.searchParams.get('limit') ?? '20', 10), 1, 100, 20);
  const theme = ((): 'auto' | 'light' | 'dark' => {
    const t = url.searchParams.get('theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  })();

  // ----- fetch events (same SQL the public API uses, inlined to avoid a self-fetch hop) -----
  const radiusKm = radiusMi * 1.60934;
  const rows = (await sql`
    SELECT
      a.id, a.title, a.start_at, a.url, a.image_url,
      a.venue_name, a.city, a.region,
      a.cost_min_cents, a.cost_max_cents, a.currency, a.availability,
      a.organizer_name
    FROM activities a
    WHERE a.url IS NOT NULL
      AND a.url <> ''
      AND a.is_virtual = false
      -- Show events that haven't ended yet (or, if no end_at, haven't started)
      AND COALESCE(a.end_at, a.start_at) >= now()
      AND a.start_at <= now() + (${days}::int * interval '1 day')
      AND ST_DWithin(
        a.location::geography,
        ST_MakePoint(${lng}, ${lat})::geography,
        ${radiusKm * 1000}
      )
    ORDER BY a.start_at ASC
    LIMIT ${limit}
  `) as unknown as Array<{
    id: string;
    title: string;
    start_at: Date;
    url: string;
    image_url: string | null;
    venue_name: string | null;
    city: string | null;
    region: string | null;
    cost_min_cents: number | null;
    cost_max_cents: number | null;
    currency: string | null;
    availability: string;
    organizer_name: string | null;
  }>;

  return htmlResponse(renderPage(rows, { theme, days, presetId, lat, lng }));
}

// ----- helpers -----

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function esc(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function htmlResponse(body: string): Response {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Allow this URL to be iframed by any site. The data is gated by
      // the API key, not the framing origin.
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': "frame-ancestors *;",
      // Discourage indexing the bare embed URL.
      'X-Robots-Tag': 'noindex, nofollow',
      // Cache short — partners want freshness over hit-rate. 60s is fine
      // for a feed that updates via a daily cron anyway.
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
  });
}

function errorPage(message: string): string {
  return baseShell(`<div class="pa-error">${esc(message)}</div>`, 'auto');
}

function renderPage(
  rows: ReadonlyArray<{
    id: string;
    title: string;
    start_at: Date;
    url: string;
    image_url: string | null;
    venue_name: string | null;
    city: string | null;
    region: string | null;
    cost_min_cents: number | null;
    cost_max_cents: number | null;
    currency: string | null;
    availability: string;
    organizer_name: string | null;
  }>,
  opts: { theme: 'auto' | 'light' | 'dark'; days: number; presetId?: string; lat?: number; lng?: number },
): string {
  // CTA pointing back to proactivity.app — lets viewers either submit
  // their own event or browse the full feed beyond what this embed shows.
  // Forward the preset (or lat/lng) so the homepage lands them in the same
  // region they were just browsing in the embed.
  const passLoc = new URLSearchParams();
  if (opts.presetId) passLoc.set('location', opts.presetId);
  else if (opts.lat != null && opts.lng != null) {
    passLoc.set('lat', String(opts.lat));
    passLoc.set('lng', String(opts.lng));
  }
  const browseQs = passLoc.toString() ? `?${passLoc.toString()}&utm_source=embed` : '?utm_source=embed';
  const submitQs = passLoc.toString() ? `?submit=1&${passLoc.toString()}&utm_source=embed` : '?submit=1&utm_source=embed';
  const footer = `
    <div class="pa-footer">
      <a href="https://proactivity.app/${browseQs}" target="_blank" rel="noopener" class="pa-footer-link">
        Browse more events
      </a>
      <a href="https://proactivity.app/${submitQs}" target="_blank" rel="noopener" class="pa-footer-cta">
        + Submit your event
      </a>
    </div>
    <p class="pa-attr"><a href="https://proactivity.app" target="_blank" rel="noopener">Powered by Proactivity</a></p>`;

  const body = rows.length === 0
    ? `<div class="pa-empty">No upcoming events in the next ${opts.days} days.</div>${footer}`
    : `<ul class="pa-list">${rows.map(renderRow).join('')}</ul>${footer}`;
  return baseShell(body, opts.theme);
}

function renderRow(r: {
  id: string;
  title: string;
  start_at: Date;
  url: string;
  image_url: string | null;
  venue_name: string | null;
  city: string | null;
  region: string | null;
  cost_min_cents: number | null;
  cost_max_cents: number | null;
  currency: string | null;
  availability: string;
  organizer_name: string | null;
}): string {
  const start = new Date(r.start_at);
  // Use UTC-ish formatting on the server then let the client overlay below
  // (small inline script) re-format to viewer's local time.
  const iso = start.toISOString();
  const img = r.image_url
    ? `<img class="pa-row-img" src="${esc(r.image_url)}" alt="" loading="lazy" />`
    : `<div class="pa-row-img pa-row-img-placeholder">★</div>`;
  const place = [r.venue_name, r.city].filter(Boolean).join(' · ');
  const price = formatPrice(r.cost_min_cents, r.cost_max_cents, r.currency);
  const badge = r.availability && r.availability !== 'onsale'
    ? `<span class="pa-row-badge">${esc(r.availability.replace('_', ' '))}</span>`
    : '';
  return `
    <li class="pa-row">
      <a href="${esc(r.url)}" target="_blank" rel="noopener" class="pa-row-link">
        ${img}
        <div class="pa-row-body">
          <p class="pa-row-title">${esc(r.title)}</p>
          ${r.organizer_name ? `<p class="pa-row-org">${esc(r.organizer_name)}</p>` : ''}
          <p class="pa-row-meta"><time data-iso="${iso}">${esc(start.toUTCString())}</time>${place ? ` · ${esc(place)}` : ''}</p>
        </div>
        <div class="pa-row-right">
          ${price ? `<span class="pa-row-price">${esc(price)}</span>` : ''}
          ${badge}
        </div>
      </a>
    </li>`;
}

function formatPrice(min: number | null, max: number | null, currency: string | null): string | null {
  if (min == null && max == null) return null;
  if (min === 0 && (max == null || max === 0)) return 'Free';
  const sym = currency === 'USD' ? '$' : (currency ?? '$');
  if (min != null && max != null && min !== max) return `${sym}${(min / 100).toFixed(0)}–${sym}${(max / 100).toFixed(0)}`;
  const n = (min ?? max)!;
  return `${sym}${(n / 100).toFixed(0)}`;
}

function baseShell(bodyHtml: string, theme: 'auto' | 'light' | 'dark'): string {
  // Inline CSS + tiny inline JS for (a) reformatting <time data-iso> in the
  // viewer's local timezone and (b) postMessage'ing height to the parent
  // window so the embed.js loader can auto-resize the iframe.
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Proactivity events</title>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .pa-root { padding: 12px; color: var(--pa-fg); background: var(--pa-bg); }
  .pa-root[data-theme="light"] {
    --pa-bg: #fff; --pa-bg-row: #fafafa; --pa-fg: #111;
    --pa-fg-muted: #666; --pa-border: #e5e5ea; --pa-accent: #6d28d9;
  }
  .pa-root[data-theme="dark"] {
    --pa-bg: #0c0d10; --pa-bg-row: #16181d; --pa-fg: #f3f3f5;
    --pa-fg-muted: #8a8d97; --pa-border: #24262d; --pa-accent: #a78bfa;
  }
  .pa-root[data-theme="auto"] {
    --pa-bg: #fff; --pa-bg-row: #fafafa; --pa-fg: #111;
    --pa-fg-muted: #666; --pa-border: #e5e5ea; --pa-accent: #6d28d9;
  }
  @media (prefers-color-scheme: dark) {
    .pa-root[data-theme="auto"] {
      --pa-bg: #0c0d10; --pa-bg-row: #16181d; --pa-fg: #f3f3f5;
      --pa-fg-muted: #8a8d97; --pa-border: #24262d; --pa-accent: #a78bfa;
    }
  }
  .pa-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .pa-row { background: var(--pa-bg-row); border: 1px solid var(--pa-border); border-radius: 8px; overflow: hidden; }
  .pa-row-link {
    display: grid; grid-template-columns: 72px 1fr auto;
    gap: 12px; align-items: center; padding: 10px;
    color: inherit; text-decoration: none;
  }
  .pa-row-link:hover { background: rgba(109, 40, 217, 0.06); }
  .pa-row-img { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; background: var(--pa-border); }
  .pa-row-img-placeholder { display: flex; align-items: center; justify-content: center; color: #fff; background: var(--pa-accent); font-size: 28px; }
  .pa-row-body { min-width: 0; }
  .pa-row-title { font-weight: 600; font-size: 14px; margin: 0 0 2px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .pa-row-org { margin: 0 0 4px; font-size: 12px; color: var(--pa-fg-muted); }
  .pa-row-meta { margin: 0; font-size: 12px; color: var(--pa-fg-muted); }
  .pa-row-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-size: 12px; }
  .pa-row-price { font-weight: 600; color: var(--pa-fg); }
  .pa-row-badge { text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--pa-border); color: var(--pa-fg-muted); }
  .pa-footer {
    margin: 12px 0 0; padding: 10px 12px;
    background: var(--pa-bg-row); border: 1px solid var(--pa-border);
    border-radius: 8px;
    display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
    justify-content: space-between;
  }
  .pa-footer-link {
    color: var(--pa-fg-muted); text-decoration: none; font-size: 13px; font-weight: 500;
  }
  .pa-footer-link:hover { color: var(--pa-accent); text-decoration: underline; }
  .pa-footer-cta {
    background: var(--pa-accent); color: #fff !important; text-decoration: none;
    padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600;
    white-space: nowrap;
  }
  .pa-footer-cta:hover { filter: brightness(1.08); }
  .pa-attr { margin: 8px 4px 0; font-size: 11px; color: var(--pa-fg-muted); text-align: right; }
  .pa-attr a { color: var(--pa-fg-muted); text-decoration: none; }
  .pa-attr a:hover { text-decoration: underline; color: var(--pa-accent); }
  .pa-error, .pa-empty { padding: 24px; text-align: center; color: var(--pa-fg-muted); font-size: 14px; }
  .pa-error { color: #c44; }
</style>
</head>
<body>
<div class="pa-root" data-theme="${esc(theme)}">${bodyHtml}</div>
<script>
(function(){
  // 1. Reformat <time data-iso="..."> in the viewer's local timezone.
  document.querySelectorAll('time[data-iso]').forEach(function(el){
    var d = new Date(el.getAttribute('data-iso'));
    if (isNaN(d.getTime())) return;
    var day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    var t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    el.textContent = day + ' · ' + t;
  });
  // 2. Post height to parent for auto-resize.
  function postHeight(){
    try {
      window.parent.postMessage({ type: 'proactivity:resize', height: document.documentElement.scrollHeight }, '*');
    } catch(_) {}
  }
  postHeight();
  if (window.ResizeObserver) new ResizeObserver(postHeight).observe(document.body);
  window.addEventListener('load', postHeight);
})();
</script>
</body></html>`;
}
