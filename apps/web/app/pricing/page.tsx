'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '../Logo';

export default function PricingPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ user: { id: string; email: string } | null; subscription: { noAds: boolean } | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({ user: null, subscription: null }));
  }, []);

  const subscribe = async () => {
    if (!me?.user) {
      router.push('/login?next=/pricing');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'consumer_no_ads' }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isSubscribed = me?.subscription?.noAds === true;

  return (
    <main className="pricing-main">
      <header className="hero">
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h1 className="wordmark">
            <Logo size={26} className="wordmark-logo" />proactivity
          </h1>
        </Link>
        <p className="tagline">Choose your plan.</p>
      </header>

      <div className="pricing-grid">
        <div className="pricing-card">
          <h2 className="pricing-name">Free</h2>
          <p className="pricing-price"><span className="pricing-amount">$0</span></p>
          <p className="pricing-tagline">Everything you need to find things to do.</p>
          <ul className="pricing-features">
            <li>Browse all events near you</li>
            <li>Filter by category, date, distance</li>
            <li>Rate events and organizers</li>
            <li>Onboarding interest selection</li>
            <li>Shows ads</li>
          </ul>
        </div>

        <div className="pricing-card pricing-card-featured">
          <span className="pricing-badge">Plus</span>
          <h2 className="pricing-name">Plus</h2>
          <p className="pricing-price">
            <span className="pricing-amount">$4.99</span>
            <span className="pricing-period">/month</span>
          </p>
          <p className="pricing-tagline">Support the project, lose the ads.</p>
          <ul className="pricing-features">
            <li>Everything in Free</li>
            <li>No ads anywhere</li>
            <li>Early access to new features</li>
            <li>Cancel anytime</li>
          </ul>
          {isSubscribed ? (
            <button type="button" className="btn-primary pricing-cta" onClick={subscribe} disabled={busy}>
              {busy ? 'Loading…' : 'Manage subscription'}
            </button>
          ) : (
            <button type="button" className="btn-primary pricing-cta" onClick={subscribe} disabled={busy}>
              {busy ? 'Redirecting…' : me?.user ? 'Subscribe — $4.99/mo' : 'Sign in to subscribe'}
            </button>
          )}
          {error && <p className="rating-error" style={{ marginTop: 12 }}>{error}</p>}
        </div>
      </div>

      <p className="pricing-footnote">
        Powered by Stripe. Secure. Cancel from your account at any time.
      </p>
    </main>
  );
}
