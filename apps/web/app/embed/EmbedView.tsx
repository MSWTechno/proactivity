'use client';

import { useEffect, useRef, useState } from 'react';

interface EmbedEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  url: string;
  imageUrl: string | null;
  venueName: string | null;
  city: string | null;
  region: string | null;
  costMinCents: number | null;
  costMaxCents: number | null;
  currency: string | null;
  availability: string;
  organizerName: string | null;
  distanceMeters: number;
}

interface EmbedResponse {
  version: number;
  count: number;
  events: EmbedEvent[];
  error?: string;
  attribution: { name: string; url: string };
}

type Theme = 'light' | 'dark' | 'auto';

export default function EmbedView() {
  const [data, setData] = useState<EmbedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('auto');
  const rootRef = useRef<HTMLDivElement>(null);

  // Read query params + fetch events.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const themeParam = (sp.get('theme') as Theme | null) ?? 'auto';
    setTheme(themeParam);

    // Strip theme from the forwarded query (it's UI-only) and forward
    // everything else verbatim to /api/public/events.
    sp.delete('theme');
    fetch(`/api/public/events?${sp.toString()}`)
      .then(async (r) => {
        const json = (await r.json()) as EmbedResponse;
        if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
        setData(json);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Post our height to the parent so the loader can resize the iframe.
  useEffect(() => {
    if (!rootRef.current) return;
    const post = () => {
      if (!rootRef.current) return;
      const h = rootRef.current.getBoundingClientRect().height;
      try {
        window.parent.postMessage({ type: 'proactivity:resize', height: Math.ceil(h) }, '*');
      } catch { /* cross-origin postMessage fine; the parent is sandboxed */ }
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(rootRef.current);
    window.addEventListener('load', post);
    return () => {
      ro.disconnect();
      window.removeEventListener('load', post);
    };
  }, [data, error]);

  const palette =
    theme === 'dark'
      ? DARK
      : theme === 'light'
        ? LIGHT
        : null; // 'auto' picks via media query in CSS below

  return (
    <div
      ref={rootRef}
      data-theme={theme}
      style={{
        ...(palette ?? {}),
        padding: 12,
        color: 'var(--pa-fg)',
        background: 'var(--pa-bg)',
        minHeight: 100,
      }}
    >
      <style>{INLINE_CSS}</style>

      {error && <div className="pa-error">Couldn't load events: {error}</div>}

      {!error && !data && <div className="pa-loading">Loading events…</div>}

      {data && data.events.length === 0 && (
        <div className="pa-empty">No upcoming events in the next {data.events.length > 0 ? '' : ''}{(new URLSearchParams(window.location.search).get('days') ?? '7')} days.</div>
      )}

      {data && data.events.length > 0 && (
        <>
          <ul className="pa-list">
            {data.events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ul>
          <p className="pa-attr">
            <a href={data.attribution.url} target="_blank" rel="noopener">
              Powered by {data.attribution.name}
            </a>
          </p>
        </>
      )}
    </div>
  );
}

function EventRow({ event }: { event: EmbedEvent }) {
  const start = new Date(event.startAt);
  const day = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const place = [event.venueName, event.city].filter(Boolean).join(' · ');
  const price = formatPrice(event.costMinCents, event.costMaxCents, event.currency);
  return (
    <li className="pa-row">
      <a href={event.url} target="_blank" rel="noopener" className="pa-row-link">
        {event.imageUrl ? (
          <img className="pa-row-img" src={event.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="pa-row-img pa-row-img-placeholder">★</div>
        )}
        <div className="pa-row-body">
          <p className="pa-row-title">{event.title}</p>
          {event.organizerName && <p className="pa-row-org">{event.organizerName}</p>}
          <p className="pa-row-meta">
            <strong>{day}</strong> · {time}
            {place && <> · {place}</>}
          </p>
        </div>
        <div className="pa-row-right">
          {price && <span className="pa-row-price">{price}</span>}
          {event.availability && event.availability !== 'onsale' && (
            <span className="pa-row-badge">{event.availability.replace('_', ' ')}</span>
          )}
        </div>
      </a>
    </li>
  );
}

function formatPrice(min: number | null, max: number | null, currency: string | null): string | null {
  if (min == null && max == null) return null;
  if (min === 0 && (max == null || max === 0)) return 'Free';
  const sym = currency === 'USD' ? '$' : (currency ?? '$');
  if (min != null && max != null && min !== max) return `${sym}${(min / 100).toFixed(0)}–${sym}${(max / 100).toFixed(0)}`;
  const n = (min ?? max)!;
  return `${sym}${(n / 100).toFixed(0)}`;
}

const LIGHT: React.CSSProperties = {
  ['--pa-bg' as never]: '#ffffff',
  ['--pa-bg-row' as never]: '#fafafa',
  ['--pa-fg' as never]: '#111',
  ['--pa-fg-muted' as never]: '#666',
  ['--pa-border' as never]: '#e5e5ea',
  ['--pa-accent' as never]: '#6d28d9',
};
const DARK: React.CSSProperties = {
  ['--pa-bg' as never]: '#0c0d10',
  ['--pa-bg-row' as never]: '#16181d',
  ['--pa-fg' as never]: '#f3f3f5',
  ['--pa-fg-muted' as never]: '#8a8d97',
  ['--pa-border' as never]: '#24262d',
  ['--pa-accent' as never]: '#a78bfa',
};

const INLINE_CSS = `
  [data-theme="auto"] {
    --pa-bg: #fff; --pa-bg-row: #fafafa; --pa-fg: #111;
    --pa-fg-muted: #666; --pa-border: #e5e5ea; --pa-accent: #6d28d9;
  }
  @media (prefers-color-scheme: dark) {
    [data-theme="auto"] {
      --pa-bg: #0c0d10; --pa-bg-row: #16181d; --pa-fg: #f3f3f5;
      --pa-fg-muted: #8a8d97; --pa-border: #24262d; --pa-accent: #a78bfa;
    }
  }
  .pa-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .pa-row { background: var(--pa-bg-row); border: 1px solid var(--pa-border); border-radius: 8px; overflow: hidden; }
  .pa-row-link {
    display: grid;
    grid-template-columns: 72px 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 10px;
    color: inherit;
    text-decoration: none;
  }
  .pa-row-link:hover { background: rgba(109, 40, 217, 0.04); }
  .pa-row-img { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; background: var(--pa-border); }
  .pa-row-img-placeholder {
    display: flex; align-items: center; justify-content: center;
    color: #fff; background: var(--pa-accent); font-size: 28px;
  }
  .pa-row-body { min-width: 0; }
  .pa-row-title {
    font-weight: 600; font-size: 14px; margin: 0 0 2px;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .pa-row-org { margin: 0 0 4px; font-size: 12px; color: var(--pa-fg-muted); }
  .pa-row-meta { margin: 0; font-size: 12px; color: var(--pa-fg-muted); }
  .pa-row-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-size: 12px; }
  .pa-row-price { font-weight: 600; color: var(--pa-fg); }
  .pa-row-badge {
    text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px;
    padding: 2px 6px; border-radius: 4px;
    background: var(--pa-border); color: var(--pa-fg-muted);
  }
  .pa-attr { margin: 12px 0 0; font-size: 11px; color: var(--pa-fg-muted); text-align: right; }
  .pa-attr a { color: var(--pa-fg-muted); text-decoration: none; }
  .pa-attr a:hover { text-decoration: underline; color: var(--pa-accent); }
  .pa-error, .pa-loading, .pa-empty {
    padding: 24px; text-align: center; color: var(--pa-fg-muted); font-size: 14px;
  }
  .pa-error { color: #c44; }
`;
