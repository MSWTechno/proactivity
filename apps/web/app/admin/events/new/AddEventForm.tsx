'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '../../../Logo';

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
  { name: 'url', label: 'Event URL', type: 'url', placeholder: 'https://…', required: true, hint: 'Where users go to register or learn more. Required — we don\'t publish events without a link.' },
  { name: 'imageUrl', label: 'Image URL', type: 'url', placeholder: 'https://…' },
  { name: 'venueName', label: 'Venue name', placeholder: 'e.g. Horizons Edge Sports Complex' },
  { name: 'address', label: 'Address', placeholder: 'Street, City' },
  { name: 'city', label: 'City' },
  { name: 'region', label: 'State / Region', placeholder: 'VA' },
  { name: 'organizerName', label: 'Organizer name' },
  { name: 'organizerUrl', label: 'Organizer URL', type: 'url' },
  { name: 'costMin', label: 'Cost min ($)', inputMode: 'decimal' },
  { name: 'costMax', label: 'Cost max ($)', inputMode: 'decimal', hint: 'Leave blank if same as min, or both blank if unspecified.' },
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
  { name: 'categories', label: 'Categories', placeholder: 'sports, family, league', hint: 'Comma-separated. Free-form — used for matching.' },
];

interface AddEventFormProps {
  initialValues?: Record<string, string>;
  contactMeta?: {
    id: string;
    name: string | null;
    email: string;
    organization: string | null;
  };
}

export default function AddEventForm({ initialValues, contactMeta }: AddEventFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({
    availability: 'onsale',
    ...(initialValues ?? {}),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (name: string, value: string) =>
    setValues((v) => ({ ...v, [name]: value }));

  // Back button + post-save destination: when launched from the moderation
  // queue ("Mark added"), bounce back there so the admin sees the row
  // disappear. Otherwise return to the events list as before.
  const exitHref = contactMeta ? '/admin/moderate' : '/admin/events';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/events/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          ...(contactMeta ? { contactId: contactMeta.id } : {}),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; id?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(exitHref);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="admin-main">
      <header className="admin-header">
        <h1 className="wordmark">
          <Logo size={26} className="wordmark-logo" />proactivity{' '}
          <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: 18 }}>admin</span>
        </h1>
        <Link href={exitHref} className="admin-logout">← Back</Link>
      </header>

      <h2 className="admin-section-title" style={{ marginBottom: 16 }}>
        {contactMeta ? 'Add event from submission' : 'Add event manually'}
      </h2>
      {contactMeta && (
        <div
          style={{
            margin: '0 0 20px',
            padding: '12px 16px',
            background: 'var(--bg-subtle, #f4f4f8)',
            border: '1px solid var(--border, #e5e5ea)',
            borderRadius: 8,
            fontSize: 14,
            maxWidth: 600,
          }}
        >
          <strong>From contact submission:</strong>{' '}
          {contactMeta.name ?? '(no name)'}{' '}
          <a href={`mailto:${contactMeta.email}`}>&lt;{contactMeta.email}&gt;</a>
          {contactMeta.organization && <> · {contactMeta.organization}</>}
          <div style={{ fontSize: 12, color: 'var(--fg-muted, #666)', marginTop: 6 }}>
            Submission will be marked <strong>added</strong> after you save.
          </div>
        </div>
      )}
      <p className="onboarding-sub" style={{ marginBottom: 24, maxWidth: 600 }}>
        {contactMeta
          ? 'Fill in date, time, venue, and any other missing fields, then save. The activity is created and the submission is resolved in one step.'
          : 'Use this when an event can\'t be auto-ingested (private dashboard, paper flyer, phone call from organizer, etc.).'}{' '}
        Required: title, start, URL. Defaults to Harrisonburg coordinates if you leave lat/lng blank.
      </p>

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
                placeholder={f.placeholder}
              />
            ) : f.type === 'select' ? (
              <select
                id={f.name}
                value={values[f.name] ?? ''}
                onChange={(e) => set(f.name, e.target.value)}
              >
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
                placeholder={f.placeholder}
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
            {submitting ? 'Saving…' : 'Save event'}
          </button>
          <Link href="/admin/events" className="onboarding-skip" style={{ display: 'inline-block', textDecoration: 'none' }}>
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
