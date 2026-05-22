import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { sql } from '@proactivity/db';
import { Logo } from '../../../Logo';
import { categorize, type CategoryKey } from '@/lib/categories';
import { findPresetBySeoSlug, LOCATION_PRESETS, type LocationPreset } from '@/lib/locations';
import { findWindow, WINDOWS, type WindowDef } from '@/lib/seo-windows';
import { placeholderFor } from '@/lib/icons';

export const dynamic = 'force-dynamic';
// 30-minute cache hint — landing pages don't need to be fresher than that
// and rebuilding the SQL on every hit during a Googlebot crawl is wasteful.
export const revalidate = 1800;

const SITE_BASE = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? 'https://proactivity.app';
const RADIUS_KM = 50; // ~31 mi — wide enough to catch JMU / Bridgewater / etc

interface PageParams {
  city: string;
  window?: string[];
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  start_at: Date;
  end_at: Date | null;
  venue_name: string | null;
  city: string | null;
  region: string | null;
  cost_min_cents: number | null;
  cost_max_cents: number | null;
  currency: string | null;
  availability: string;
  image_url: string | null;
  url: string | null;
  categories: string[] | null;
  organizer_name: string | null;
}

async function loadEvents(preset: LocationPreset, win: WindowDef | null) {
  const now = new Date();
  const filter = win ? win.buildFilter(now) : sql``;
  const limit = win?.limit ?? 40;
  const rows = (await sql`
    SELECT
      a.id, a.title, a.description, a.start_at, a.end_at,
      a.venue_name, a.city, a.region,
      a.cost_min_cents, a.cost_max_cents, a.currency,
      a.availability, a.image_url, a.url, a.categories,
      a.organizer_name
    FROM activities a
    WHERE a.url IS NOT NULL AND a.url <> ''
      AND a.is_virtual = false
      AND COALESCE(a.end_at, a.start_at) >= now()
      AND ST_DWithin(
        a.location::geography,
        ST_SetSRID(ST_MakePoint(${preset.lng}, ${preset.lat}), 4326)::geography,
        ${RADIUS_KM * 1000}
      )
      ${filter}
    ORDER BY a.start_at ASC
    LIMIT ${limit}
  `) as unknown as EventRow[];
  return rows;
}

// ---- Metadata --------------------------------------------------------------

function titleFor(preset: LocationPreset, win: WindowDef | null): string {
  const place = `${preset.seoCity}, ${preset.seoRegion}`;
  return win
    ? `Fun Things to Do in ${place} ${win.label} — Proactivity`
    : `Fun Things to Do in ${place} — Proactivity`;
}

function descFor(preset: LocationPreset, win: WindowDef | null, count: number): string {
  const place = `${preset.seoCity}, ${preset.seoRegion}`;
  if (!win) {
    return `${count} upcoming local events in ${place} — concerts, festivals, family activities, sports, and more. Updated daily.`;
  }
  return `${count} things to do ${win.metaPhrase} in ${place}. Live events list, refreshed daily on Proactivity.`;
}

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { city, window } = await params;
  const preset = findPresetBySeoSlug(city);
  if (!preset) return { title: 'Not found · Proactivity' };
  const win = window && window[0] ? findWindow(window[0]) : null;
  if (window && window[0] && !win) return { title: 'Not found · Proactivity' };

  const canonical = win
    ? `${SITE_BASE}/things-to-do/${preset.seoSlug}/${win.slug}`
    : `${SITE_BASE}/things-to-do/${preset.seoSlug}`;
  const title = titleFor(preset, win);
  // Hit the DB lazily so we have a real count in the description — the
  // landing page renders it anyway so this is essentially free.
  let count = 0;
  try {
    const rows = await loadEvents(preset, win);
    count = rows.length;
  } catch { /* empty count, generic copy */ }
  const description = descFor(preset, win, count);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: 'website', url: canonical, title, description },
    twitter: { card: 'summary', title, description },
  };
}

// ---- Page ------------------------------------------------------------------

export default async function Page({ params }: { params: Promise<PageParams> }) {
  const { city, window } = await params;
  const preset = findPresetBySeoSlug(city);
  if (!preset) notFound();
  const win = window && window[0] ? findWindow(window[0]) : null;
  if (window && window[0] && !win) notFound();
  if (window && window.length > 1) notFound(); // only [city]/[window], no deeper

  const events = await loadEvents(preset, win);
  const place = `${preset.seoCity}, ${preset.seoRegion}`;
  const h1 = win
    ? `Fun Things to Do in ${place} ${win.label}`
    : `Fun Things to Do in ${place}`;

  // ItemList JSON-LD wrapping the events for richer SERP eligibility.
  // Each event already emits its own Event schema on /event/[id]; this
  // tells Google "here is a curated list" so it can render carousels.
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: events.slice(0, 20).map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_BASE}/event/${e.id}`,
      name: e.title,
    })),
  };
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_BASE + '/' },
      { '@type': 'ListItem', position: 2, name: `Things to Do in ${place}`, item: `${SITE_BASE}/things-to-do/${preset.seoSlug}` },
      ...(win ? [{ '@type': 'ListItem', position: 3, name: win.label, item: `${SITE_BASE}/things-to-do/${preset.seoSlug}/${win.slug}` }] : []),
    ],
  };

  return (
    <main className="event-detail">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />

      <header style={{ marginBottom: 16 }}>
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h1 className="wordmark" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Logo size={26} className="wordmark-logo" />proactivity
          </h1>
        </Link>
        <nav style={{ fontSize: 13, marginTop: 6, color: 'var(--fg-muted)' }}>
          <Link href="/">Home</Link>
          {' › '}
          <Link href={`/things-to-do/${preset.seoSlug}`}>Things to Do in {place}</Link>
          {win && (
            <>
              {' › '}
              <span>{win.label}</span>
            </>
          )}
        </nav>
      </header>

      <h1 className="event-detail-title" style={{ marginBottom: 4 }}>{h1}</h1>
      <p style={{ color: 'var(--fg-muted)', marginBottom: 24 }}>
        {events.length === 0
          ? `No matching events right now — check back soon or browse all events.`
          : `${events.length} upcoming ${events.length === 1 ? 'event' : 'events'} within ~30 miles, refreshed daily.`}
      </p>

      {/* Sibling-window navigation — also useful internal linking for SEO. */}
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
        <Link
          href={`/things-to-do/${preset.seoSlug}`}
          className="card-tag"
          style={{ textDecoration: 'none', fontWeight: win === null ? 600 : 400 }}
        >
          All upcoming
        </Link>
        {WINDOWS.map((w) => (
          <Link
            key={w.slug}
            href={`/things-to-do/${preset.seoSlug}/${w.slug}`}
            className="card-tag"
            style={{ textDecoration: 'none', fontWeight: win?.slug === w.slug ? 600 : 400 }}
          >
            {w.label}
          </Link>
        ))}
      </nav>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
        {events.map((e) => {
          // Raw source categories ("Concert", "Workshop", …) don't match
          // our canonical CategoryKey set — derive the canonical list the
          // same way the API does so placeholderFor doesn't crash on
          // CATEGORIES[unknown_key].emoji.
          const canonical = categorize({
            rawCategories: e.categories,
            title: e.title,
            description: e.description,
            venueName: e.venue_name,
          }) as CategoryKey[];
          const ph = placeholderFor({
            title: e.title,
            venueName: e.venue_name,
            organizerName: e.organizer_name,
            canonicalCategories: canonical,
          });
          const when = new Date(e.start_at).toLocaleString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
          });
          const where = [e.venue_name, e.city].filter(Boolean).join(' · ');
          return (
            <li key={e.id}>
              <Link
                href={`/event/${e.id}`}
                className="card"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                {e.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="card-img" src={e.image_url} alt="" loading="lazy" />
                ) : (
                  <div
                    className="card-img card-img-placeholder"
                    style={{ backgroundColor: ph.color, color: 'white' }}
                  >
                    {ph.emoji}
                  </div>
                )}
                <div className="card-body">
                  <p className="card-title">{e.title}</p>
                  {e.organizer_name && <p className="card-organizer">{e.organizer_name}</p>}
                  <p className="card-meta">
                    <time dateTime={e.start_at.toISOString()}>{when}</time>
                    {where ? <> · {where}</> : null}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Browse other locations</h2>
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {LOCATION_PRESETS.filter((p) => p.seoSlug !== preset.seoSlug).map((p) => (
            <li key={p.seoSlug}>
              <Link href={`/things-to-do/${p.seoSlug}`} className="card-tag">
                Things to Do in {p.seoCity}, {p.seoRegion}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <p style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
          Looking for something specific? <Link href="/">Browse all events →</Link>
        </p>
      </footer>
    </main>
  );
}
