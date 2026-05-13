'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Logo } from '../Logo';

function LoginInner() {
  const params = useSearchParams();
  const errorParam = params.get('error');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(errorParam);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="admin-login">
      <h1 className="wordmark" style={{ marginBottom: 20 }}>
        <Logo size={26} className="wordmark-logo" />proactivity
      </h1>
      {sent ? (
        <>
          <h2 className="onboarding-title" style={{ marginBottom: 6 }}>Check your inbox</h2>
          <p className="onboarding-sub">
            We sent a sign-in link to <strong>{email}</strong>. Click it to continue.
            The link expires in 15 minutes.
          </p>
        </>
      ) : (
        <>
          <p className="onboarding-sub" style={{ marginBottom: 18 }}>
            Enter your email and we'll send you a one-time sign-in link.
            No password required.
          </p>
          <form onSubmit={submit} className="admin-login-form">
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rating-input"
              maxLength={200}
            />
            {error && <p className="rating-error">{error}</p>}
            <button type="submit" className="btn-primary" disabled={submitting || !email}>
              {submitting ? 'Sending…' : 'Send me a sign-in link'}
            </button>
          </form>
        </>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="admin-login"><p>Loading…</p></main>}>
      <LoginInner />
    </Suspense>
  );
}
