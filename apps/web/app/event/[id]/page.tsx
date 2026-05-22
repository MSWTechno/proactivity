import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { sql } from '@proactivity/db';
import { Logo } from '../../Logo';
import { categorize, CATEGORIES, type CategoryKey } from '@/lib/categories';
import { inferAgeRange } from '@/lib/age';
import { placeholderFor } from '@/lib/icons';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE_BASE = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? 'https://proactivity.app';

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  timezone: string | null;
  venueName: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  ageMin: number | null;
  ageMax: number | null;
  costMinCents: number | null;
  costMaxCents: number | null;
  currency: string | null;
  availability: string;
  isVirtual: boolean;
  organizerName: string | null;
  organizerUrl: string | null;
  organizerKey: string | null;
  url: string | null;
  imageUrl: string | null;
  categories: string[] | null;
  clickCount: number;
  ratingAverage: number | null;
  ratingCount: number;
}

async function loadEvent(id: string): Promise<EventRow | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = (await sql`
    SELECT
      a.id, a.title, a.description, a.start_at, a.end_at, a.timezone,
      a.venue_name, a.address, a.city, a.region,
      ST_X(a.location::geometry) AS lng, ST_Y(a.location::geometry) AS lat,
      a.age_min, a.age_max,
      a.cost_min_cents, a.cost_max_cents, a.currency,
      a.availability, a.is_virtual,
      a.organizer_name, a.organizer_url, a.organizer_key,
      a.url, a.image_url, a.categories, a.click_count,
      COALESCE(rs.avg, NULL) AS rating_average,
      COALESCE(rs.cnt, 0)::int AS rating_count
    FROM activities a
    LEFT JOIN LATERAL (
      SELECT AVG(r.score)::float AS avg, COUNT(*)::int AS cnt
      FROM ratings r
      WHERE r.status = 'approved'
        AND r.target_kind = 'event'
        AND r.source_id = a.source_id
        AND r.target_key = SPLIT_PART(a.source_event_id, '::', 1)
    ) rs ON true
    WHERE a.id = ${id}
    LIMIT 1
  `) as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    id: r.id as string,
    title: r.title as string,
    description: r.description as string | null,
    startAt: r.start_at as Date,
    endAt: r.end_at as Date | null,
    timezone: r.timezone as string | null,
    venueName: r.venue_name as string | null,
    address: r.address as string | null,
    city: r.city as string | null,
    region: r.region as string | null,
    lat: r.lat as number | null,
    lng: r.lng as number | null,
    ageMin: r.age_min as number | null,
    ageMax: r.age_max as number | null,
    costMinCents: r.cost_min_cents as number | null,
    costMaxCents: r.cost_max_cents as number | null,
    currency: r.currency as string | null,
    availability: r.availability as string,
    isVirtual: r.is_virtual as boolean,
    organizerName: r.organizer_name as string | null,
    organizerUrl: r.organizer_url as string | null,
    organizerKey: r.organizer_key as string | null,
    url: r.url as string | null,
    imageUrl: r.image_url as string | null,
    categories: r.categories as string[] | null,
    clickCount: r.click_count as number,
    ratingAverage: r.rating_average as number | null,
    ratingCount: r.rating_count as number,
  };
}

function shortDescription(text: string | null, max = 160): string {
  if (!text) return '';
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1).trimEnd() + '…';
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const e = await loadEvent(id);
  if (!e) return { title: 'Event not found · Proactivity' };
  const dateStr = new Date(e.startAt).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const place = [e.venueName, e.city, e.region].filter(Boolean).join(', ');
  const title = `${e.title} · ${dateStr}${place ? ' · ' + place : ''}`;
  const description = shortDescription(e.description) || `${e.title} at ${place || 'a venue'} on ${dateStr}. Find more local events on Proactivity.`;
  const canonical = `${SITE_BASE}/event/${e.id}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      url: canonical,
      title: e.title,
      description,
      ...(e.imageUrl ? { images: [{ url: e.imageUrl }] } : {}),
    },
    twitter: {
      card: e.imageUrl ? 'summary_large_image' : 'summary',
      title: e.title,
      description,
      ...(e.imageUrl ? { images: [e.imageUrl] } : {}),
    },
  };
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await loadEvent(id);
  if (!e) notFound();

  const canonicalCategories = categorize({
    rawCategories: e.categories,
    title: e.title,
    description: e.description,
    venueName: e.venueName,
  });
  const ageRange = inferAgeRange({
    title: e.title,
    description: e.description,
    ageMin: e.ageMin,
    ageMax: e.ageMax,
  });
  const placeholder = placeholderFor({
    title: e.title,
    venueName: e.venueName,
    organizerName: e.organizerName,
    canonicalCategories: canonicalCategories as CategoryKey[],
  });

  const start = new Date(e.startAt);
  const end = e.endAt ? new Date(e.endAt) : null;
  const dateLabel = start.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const place = [e.venueName, e.address, e.city, e.region].filter(Boolean).join(', ');
  // Coords beat free-text for Google Maps directions because the address
  // geocoder occasionally lands on a similarly-named place in another
  // state. Fall back to address only when we have no pin.
  const mapsDestination = e.lat != null && e.lng != null
    ? `${e.lat},${e.lng}`
    : place || e.venueName || '';
  const mapsUrl = mapsDestination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsDestination)}`
    : null;
  const price = formatPrice(e.costMinCents, e.costMaxCents, e.currency);

  // schema.org Event JSON-LD — gives Google Events rich result eligibility.
  // Image, offers (with price/priceCurrency/validFrom) and performer all
  // have fallbacks because Google Search Console flags missing fields as
  // non-critical issues — defaults keep us rich-result eligible across
  // sparsely-fielded sources like iCal feeds.
  const imageFallback = `${SITE_BASE}/proactivity-icon-1080.png`;
  const offerCurrency = e.currency ?? 'USD';
  const offerPrice = e.costMinCents != null ? (e.costMinCents / 100).toFixed(2) : '0';
  // validFrom = "when this offer became available". We don't track listing
  // date per-row; ISO-now is the closest honest answer (offer is available
  // as of page render) and Google accepts it.
  const offerValidFrom = new Date().toISOString();
  const organizerEntity = e.organizerName
    ? {
        '@type': 'Organization',
        name: e.organizerName,
        ...(e.organizerUrl ? { url: e.organizerUrl } : {}),
      }
    : null;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    startDate: start.toISOString(),
    // Google flags missing endDate as a non-critical issue, so we
    // default to start + 2h for sources that don't supply one (most
    // aggregated listings are 1–3h).
    endDate: (end ?? new Date(start.getTime() + 2 * 60 * 60 * 1000)).toISOString(),
    eventAttendanceMode: e.isVirtual
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: e.availability === 'cancelled'
      ? 'https://schema.org/EventCancelled'
      : 'https://schema.org/EventScheduled',
    url: `${SITE_BASE}/event/${e.id}`,
    ...(e.description ? { description: e.description } : {}),
    image: [e.imageUrl ?? imageFallback],
    ...(e.url
      ? {
          offers: {
            '@type': 'Offer',
            url: e.url,
            availability: 'https://schema.org/InStock',
            price: offerPrice,
            priceCurrency: offerCurrency,
            validFrom: offerValidFrom,
          },
        }
      : {}),
    ...(e.venueName || e.address ? {
      location: {
        '@type': 'Place',
        name: e.venueName ?? 'Venue',
        ...(e.address || e.city ? {
          address: {
            '@type': 'PostalAddress',
            ...(e.address ? { streetAddress: e.address } : {}),
            ...(e.city ? { addressLocality: e.city } : {}),
            ...(e.region ? { addressRegion: e.region } : {}),
            addressCountry: 'US',
          },
        } : {}),
        ...(e.lat != null && e.lng != null ? { geo: { '@type': 'GeoCoordinates', latitude: e.lat, longitude: e.lng } } : {}),
      },
    } : {}),
    ...(organizerEntity
      ? {
          organizer: organizerEntity,
          // performer defaults to the organizer for aggregated events —
          // we rarely know the actual artist/speaker separately.
          performer: organizerEntity,
        }
      : {}),
  };

  return (
    <main className="event-detail">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header style={{ marginBottom: 16 }}>
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h1 className="wordmark" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Logo size={26} className="wordmark-logo" />proactivity
          </h1>
        </Link>
        <Link href="/" style={{ fontSize: 13, marginLeft: 12 }}>← All events</Link>
      </header>

      <article>
        {e.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.imageUrl} alt="" className="event-detail-hero" />
        ) : (
          <div
            className="event-detail-hero event-detail-hero-placeholder"
            style={{ background: placeholder.color }}
          >
            {placeholder.emoji}
          </div>
        )}

        <h1 className="event-detail-title">{e.title}</h1>

        {e.organizerName && (
          <p className="event-detail-org">
            by <strong>{e.organizerName}</strong>
            {e.ratingCount > 0 && e.ratingAverage != null && (
              <span style={{ marginLeft: 8, color: 'var(--warning-fg)', fontWeight: 500, fontSize: 14 }}>
                ★ {e.ratingAverage.toFixed(1)} ({e.ratingCount})
              </span>
            )}
          </p>
        )}

        <div className="event-detail-meta">
          <div><strong>When</strong><br />{dateLabel}{end ? <> &nbsp;→&nbsp; {end.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</> : null}</div>
          {place && (
            <div>
              <strong>Where</strong><br />
              {mapsUrl ? (
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                  {place} <span aria-hidden>↗</span>
                </a>
              ) : place}
            </div>
          )}
          {price && <div><strong>Price</strong><br />{price}</div>}
          {ageRange && <div><strong>Ages</strong><br />{ageRange.label}</div>}
        </div>

        {e.url && (
          <p style={{ margin: '20px 0' }}>
            <a
              href={`/api/activities/${e.id}/go`}
              className="btn-primary"
              style={{ display: 'inline-block', textDecoration: 'none', padding: '12px 22px', fontSize: 16 }}
              rel="noopener"
            >
              Get tickets / official page ↗
            </a>
          </p>
        )}

        {e.description && (
          <section className="event-detail-description">
            <h2>About</h2>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{e.description}</p>
          </section>
        )}

        {canonicalCategories.length > 0 && (
          <p className="card-tags" style={{ marginTop: 16 }}>
            {canonicalCategories.slice(0, 6).map((k) => (
              <span key={k} className="card-tag">
                {CATEGORIES[k as CategoryKey].emoji} {CATEGORIES[k as CategoryKey].label}
              </span>
            ))}
          </p>
        )}

        <footer style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
            Run an event near {e.city ?? 'here'}?{' '}
            <Link href="/?submit=1">Submit your own →</Link>
          </p>
          <p style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 12 }}>
            This event listing is aggregated from public sources. Verify details
            with the organizer before attending.
          </p>
        </footer>
      </article>
    </main>
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
