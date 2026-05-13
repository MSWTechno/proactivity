'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Logo } from '../Logo';

interface Claim {
  id: string;
  organizerKey: string;
  organizerName: string | null;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  moderatorNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  eventCount: number;
  upcomingCount: number;
  totalClicks: number;
  clicks30d: number;
}

interface Organization {
  key: string;
  name: string | null;
  url: string | null;
  eventCount: number;
  totalClicks: number;
}

const FREE_TIER_CLICK_LIMIT = 100;

export default function OrganizerDashboard() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [noAdsActive, setNoAdsActive] = useState(false);
  const [orgProActive, setOrgProActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showClaimForm, setShowClaimForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [meRes, claimRes] = await Promise.all([
      fetch('/api/auth/me').then((r) => r.json()),
      fetch('/api/organizer/claim').then((r) => r.json()),
    ]);
    setClaims(claimRes.claims ?? []);
    setNoAdsActive(meRes.subscription?.noAds ?? false);
    setOrgProActive(meRes.subscription?.organizerPro ?? false);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const subscribe = async () => {
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'organizer_pro' }),
    });
    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      alert(data.error ?? 'Checkout failed');
      return;
    }
    window.location.href = data.url;
  };

  const approvedClaims = claims.filter((c) => c.status === 'approved');
  const pendingClaims = claims.filter((c) => c.status === 'pending');
  const rejectedClaims = claims.filter((c) => c.status === 'rejected');
  const totalApprovedClicks30d = approvedClaims.reduce((s, c) => s + c.clicks30d, 0);

  return (
    <main className="organizer-main">
      <header className="admin-header">
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h1 className="wordmark">
            <Logo size={26} className="wordmark-logo" />proactivity{' '}
            <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: 18 }}>organizer</span>
          </h1>
        </Link>
        <Link href="/" className="admin-logout">← Back to events</Link>
      </header>

      <section style={{ marginBottom: 24 }}>
        <p className="onboarding-sub" style={{ maxWidth: 600 }}>
          Claim the venues, leagues, and organizations you run. Once an admin approves your claim,
          your events show "Verified organizer" and (with Plus) get top-of-list placement plus
          unlimited engagement tracking.
        </p>
      </section>

      {approvedClaims.length > 0 && (
        <section className="admin-section">
          <div className="organizer-status">
            <div>
              <span className="admin-stat-label">Status</span>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                {orgProActive ? '⭐ Organizer Plus active' : 'Free tier'}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--fg-muted)' }}>
                {orgProActive
                  ? 'Featured placement + unlimited clicks'
                  : `Free up to ${FREE_TIER_CLICK_LIMIT} clicks/month. Currently ${totalApprovedClicks30d} in last 30 days.`}
              </p>
            </div>
            <div>
              <button
                type="button"
                className="btn-primary"
                onClick={subscribe}
                style={{ marginTop: 0 }}
              >
                {orgProActive ? 'Manage subscription' : 'Upgrade to Plus — $19/mo'}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="admin-section">
        <h2 className="admin-section-title">
          Your organizers <span className="admin-section-count">{loading ? '…' : claims.length}</span>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowClaimForm((v) => !v)}
            style={{ marginLeft: 'auto', marginTop: 0, padding: '8px 14px', fontSize: 13 }}
          >
            {showClaimForm ? 'Cancel' : '+ Claim an organizer'}
          </button>
        </h2>

        {showClaimForm && <ClaimForm onDone={() => { setShowClaimForm(false); load(); }} />}

        {!loading && claims.length === 0 && !showClaimForm && (
          <p className="admin-empty">No claims yet. Click "+ Claim an organizer" to get started.</p>
        )}

        <div className="organizer-list">
          {[...approvedClaims, ...pendingClaims, ...rejectedClaims].map((c) => (
            <article
              key={c.id}
              className={`organizer-card organizer-card-${c.status}`}
            >
              <div className="organizer-card-head">
                <strong>{c.organizerName ?? c.organizerKey}</strong>
                <span className={`badge organizer-status-badge organizer-status-${c.status}`}>
                  {c.status}
                </span>
              </div>
              {c.status === 'approved' && (
                <div className="organizer-card-stats">
                  <div><span>Events</span><strong>{c.eventCount}</strong></div>
                  <div><span>Upcoming</span><strong>{c.upcomingCount}</strong></div>
                  <div><span>Clicks (30d)</span><strong>{c.clicks30d}</strong></div>
                  <div><span>Clicks (all)</span><strong>{c.totalClicks}</strong></div>
                </div>
              )}
              {c.note && <p className="organizer-card-note">"{c.note}"</p>}
              {c.moderatorNote && (
                <p className="organizer-card-mod-note">Moderator note: {c.moderatorNote}</p>
              )}
            </article>
          ))}
        </div>
      </section>

      {noAdsActive && (
        <p style={{ marginTop: 24, color: 'var(--fg-muted)', fontSize: 12 }}>
          You also have Proactivity Plus (ad-free) active.
        </p>
      )}
    </main>
  );
}

function ClaimForm({ onDone }: { onDone: () => void }) {
  const [search, setSearch] = useState('');
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selected, setSelected] = useState<Organization | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/organizer/organizations${search ? `?search=${encodeURIComponent(search)}` : ''}`)
        .then((r) => r.json())
        .then((d: { organizations: Organization[] }) => setOrgs(d.organizations))
        .catch(() => setOrgs([]));
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/organizer/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizerKey: selected.key, note: note.trim() || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="claim-form">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search organizers…"
        className="rating-input"
      />
      <div className="claim-orgs">
        {orgs.length === 0 && <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No matches.</p>}
        {orgs.map((o) => (
          <button
            type="button"
            key={o.key}
            className={`claim-org ${selected?.key === o.key ? 'claim-org-selected' : ''}`}
            onClick={() => setSelected(o)}
          >
            <span style={{ fontWeight: 500 }}>{o.name ?? o.key}</span>
            <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
              {o.eventCount} events · {o.totalClicks} clicks
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why are you the organizer here? (helpful for admin review — e.g. 'I run programs at this venue, you can reach me at the contact email on their site')"
            rows={3}
            className="rating-review"
          />
          {error && <p className="rating-error">{error}</p>}
          <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Submitting…' : `Submit claim for ${selected.name ?? selected.key}`}
          </button>
        </>
      )}
    </div>
  );
}
