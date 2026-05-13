'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '../../../../Logo';

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  timezone: string | null;
  venueName: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  lng: number | null;
  lat: number | null;
  ageMin: number | null;
  ageMax: number | null;
  costMinCents: number | null;
  costMaxCents: number | null;
  currency: string | null;
  availability: string;
  isVirtual: boolean;
  organizerName: string | null;
  organizerUrl: string | null;
  url: string | null;
  imageUrl: string | null;
  categories: string[] | null;
  sourceAdapter: string | null;
  sourceName: string | null;
}

interface Field {
  name: string;
  label: string;
  type?: 'text' | 'url' | 'number' | 'datetime-local' | 'textarea' | 'select';
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  inputMode?: 'numeric' | 'decimal';
}

const FIELDS: Field[] = [
  { name: 'title', label: 'Title', required: true },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'startAt', label: 'Start (date + time)', type: 'datetime-local', required: true },
  { name: 'endAt', label: 'End (date + time)', type: 'datetime-local' },
  { name: 'url', label: 'Event URL', type: 'url' },
  { name: 'imageUrl', label: 'Image URL', type: 'url' },
  { name: 'venueName', label: 'Venue name' },
  { name: 'address', label: 'Address' },
  { name: 'city', label: 'City' },
  { name: 'region', label: 'State / Region' },
  { name: 'organizerName', label: 'Organizer name' },
  { name: 'organizerUrl', label: 'Organizer URL', type: 'url' },
  { name: 'costMin', label: 'Cost min ($)', inputMode: 'decimal' },
  { name: 'costMax', label: 'Cost max ($)', inputMode: 'decimal' },
  { name: 'ageMin', label: 'Age min', inputMode: 'numeric' },
  { name: 'ageMax', label: 'Age max', inputMode: 'numeric' },
  {
    name: 'availability',
    label: 'Availability',
    type: 'select',
    options: [
      { value: 'onsale', label: 'On sale' },
      { value: 'free', label: 'Free' },
      { value: 'dropin', label: 'Drop-in' },
      { value: 'sold_out', label: 'Sold out' },
      { value: 'cancelled', label: 'Cancelled' },
      { value: 'unknown', label: 'Unknown' },
    ],
  },
  { name: 'lat', label: 'Latitude', inputMode: 'decimal' },
  { name: 'lng', label: 'Longitude', inputMode: 'decimal' },
  { name: 'categories', label: 'Categories (comma-separated)' },
];

function toLocalDateTimeInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditEventForm({ id }: { id: string }) {
  const router = useRouter();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/events/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ event: EventRow }>;
      })
      .then(({ event: e }) => {
        setEvent(e);
        setValues({
          title: e.title,
          description: e.description ?? '',
          startAt: toLocalDateTimeInput(e.startAt),
          endAt: toLocalDateTimeInput(e.endAt),
          url: e.url ?? '',
          imageUrl: e.imageUrl ?? '',
          venueName: e.venueName ?? '',
          address: e.address ?? '',
          city: e.city ?? '',
          region: e.region ?? '',
          organizerName: e.organizerName ?? '',
          organizerUrl: e.organizerUrl ?? '',
          costMin: e.costMinCents != null ? (e.costMinCents / 100).toString() : '',
          costMax: e.costMaxCents != null ? (e.costMaxCents / 100).toString() : '',
          ageMin: e.ageMin != null ? String(e.ageMin) : '',
          ageMax: e.ageMax != null ? String(e.ageMax) : '',
          availability: e.availability,
          lat: e.lat != null ? String(e.lat) : '',
          lng: e.lng != null ? String(e.lng) : '',
          categories: e.categories?.join(', ') ?? '',
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const set = (name: string, value: string) =>
    setValues((v) => ({ ...v, [name]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push('/admin/events');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const isScraped = event?.sourceAdapter && event.sourceAdapter !== 'manual';

  return (
    <main className="admin-main">
      <header className="admin-header">
        <h1 className="wordmark">
          <Logo size={26} className="wordmark-logo" />proactivity{' '}
          <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: 18 }}>admin</span>
        </h1>
        <Link href="/admin/events" className="admin-logout">← Back to events</Link>
      </header>

      <h2 className="admin-section-title" style={{ marginBottom: 8 }}>Edit event</h2>
      {event && (
        <p className="onboarding-sub" style={{ marginBottom: 16, maxWidth: 700 }}>
          Source: <strong>{event.sourceName ?? '?'}</strong>
          {isScraped && (
            <>
              {' '}
              <span style={{ color: 'var(--warning-fg)' }}>
                — this event is from an automated source. Edits will be overwritten when ingestion next runs unless you also disable that source.
              </span>
            </>
          )}
        </p>
      )}
      {loading && <p className="onboarding-sub">Loading…</p>}

      {!loading && event && (
        <form onSubmit={submit} className="add-event-form">
          {FIELDS.map((f) => (
            <div key={f.name} className={`add-event-field ${f.type === 'textarea' ? 'add-event-field-full' : ''}`}>
              <label htmlFor={f.name}>{f.label}{f.required && ' *'}</label>
              {f.type === 'textarea' ? (
                <textarea
                  id={f.name}
                  rows={4}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              ) : f.type === 'select' ? (
                <select id={f.name} value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)}>
                  {f.options!.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={f.name}
                  type={f.type ?? 'text'}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  required={f.required}
                  inputMode={f.inputMode}
                />
              )}
              {f.hint && <p className="add-event-hint">{f.hint}</p>}
            </div>
          ))}

          {error && <p className="rating-error" style={{ gridColumn: '1 / -1' }}>{error}</p>}

          <div className="add-event-actions">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save changes'}
            </button>
            <Link href="/admin/events" className="onboarding-skip" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Cancel
            </Link>
          </div>
        </form>
      )}
    </main>
  );
}
