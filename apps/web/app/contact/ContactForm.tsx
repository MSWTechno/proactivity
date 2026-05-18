'use client';

import { useState } from 'react';

export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('A valid email is required so we can reply.');
      return;
    }
    if (message.trim().length < 10) {
      setError('Tell us a bit more (10+ characters).');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'general',
          name: name.trim() || undefined,
          email: email.trim(),
          organization: organization.trim() || undefined,
          message: message.trim(),
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
        <h2>Thanks — got it.</h2>
        <p>We'll reply to <strong>{email}</strong> after reviewing your message.</p>
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
        <span>Email <em>(required, so we can reply)</em></span>
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
        <span>Organization or venue <em>(optional)</em></span>
        <input
          type="text"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          maxLength={200}
          autoComplete="organization"
        />
      </label>

      <label>
        <span>Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          maxLength={4000}
          required
        />
      </label>

      {error && <p className="contact-error">{error}</p>}

      <button type="submit" disabled={submitting} className="contact-submit">
        {submitting ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}
