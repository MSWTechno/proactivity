'use client';

import { useEffect, useState } from 'react';

export function RequestAreaForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [regionText, setRegionText] = useState('');
  const [relationship, setRelationship] = useState<'resident' | 'organizer' | 'attendee'>('resident');
  const [committedEventCount, setCommittedEventCount] = useState('3');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Try to grab the browser's coords on mount as a courtesy — purely a
  // signal for admin clustering, never required.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
      },
      () => { /* silent — coords stay null */ },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 10 * 60 * 1000 },
    );
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Email is required.');
    if (!regionText.trim()) return setError('Tell us which area you want.');
    setSubmitting(true);
    try {
      const res = await fetch('/api/area-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim(),
          regionText: regionText.trim(),
          relationship,
          committedEventCount: committedEventCount.trim() ? Number(committedEventCount) : undefined,
          lat: lat ?? undefined,
          lng: lng ?? undefined,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="contact-success">
        <h2>Got it.</h2>
        <p>
          We'll prioritize <strong>{regionText}</strong> and email
          <strong> {email}</strong> when it's live.
        </p>
        <p style={{ marginTop: 16 }}>
          Want to get a head start? You can submit your first event right now —
          it'll be ready to publish the moment we launch your area.
        </p>
        <p style={{ marginTop: 16 }}>
          <a href={`/?submit=1${lat != null && lng != null ? `&lat=${lat}&lng=${lng}` : ''}`} className="btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
            + Submit your first event
          </a>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="contact-form">
      <label>
        <span>Your name <em>(optional)</em></span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          autoComplete="name"
        />
      </label>

      <label>
        <span>Email <em>(so we can tell you when your area launches)</em></span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={200}
          autoComplete="email"
          required
        />
      </label>

      <label>
        <span>Area you want covered</span>
        <input
          type="text"
          value={regionText}
          onChange={(e) => setRegionText(e.target.value)}
          placeholder="e.g. Charlottesville, VA  (other states also OK as future-signal)"
          maxLength={200}
          required
        />
      </label>

      <label>
        <span>Your relationship to this area</span>
        <select value={relationship} onChange={(e) => setRelationship(e.target.value as typeof relationship)}>
          <option value="resident">I live there</option>
          <option value="organizer">I run events there</option>
          <option value="attendee">I just want to attend events there</option>
        </select>
      </label>

      <label>
        <span>I'll personally seed Proactivity by adding at least <em>this many</em> events in the first month</span>
        <input
          type="number"
          min={0}
          max={1000}
          value={committedEventCount}
          onChange={(e) => setCommittedEventCount(e.target.value)}
        />
      </label>

      <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: -6 }}>
        We use this to prioritize areas where someone's willing to help bootstrap. You won't be charged — it's a good-faith commit.
      </p>

      {error && <p className="contact-error">{error}</p>}

      <button type="submit" disabled={submitting} className="contact-submit">
        {submitting ? 'Sending…' : 'Send request'}
      </button>
    </form>
  );
}
