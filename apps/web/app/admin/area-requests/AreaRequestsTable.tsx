'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '../../Logo';

interface Req {
  id: string;
  email: string;
  name: string | null;
  regionText: string;
  lat: number | null;
  lng: number | null;
  relationship: string | null;
  committedEventCount: number | null;
  status: 'requested' | 'launched' | 'rejected';
  moderatorNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export default function AreaRequestsTable() {
  const router = useRouter();
  const [items, setItems] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/area-requests')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { requests: Req[] }) => setItems(d.requests))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.replace('/admin/login');
  };

  const moderate = async (id: string, action: 'launch' | 'reject') => {
    const note = action === 'reject'
      ? window.prompt('Optional reject note (sent to the submitter):') ?? undefined
      : undefined;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/area-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      load();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  // Cluster by lower-cased region text — rough but useful for dedup
  // (multiple visitors from "Charlottesville VA" appear as one row).
  const clusters = useMemo(() => {
    const map = new Map<string, Req[]>();
    for (const r of items) {
      const key = r.regionText.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return [...map.entries()]
      .map(([key, reqs]) => ({
        key,
        regionDisplay: reqs[0]!.regionText,
        reqs,
        totalCommitted: reqs.reduce((s, r) => s + (r.committedEventCount ?? 0), 0),
        pendingCount: reqs.filter((r) => r.status === 'requested').length,
      }))
      .sort((a, b) => b.pendingCount - a.pendingCount || b.reqs.length - a.reqs.length);
  }, [items]);

  return (
    <main className="admin-main">
      <header className="admin-header">
        <h1 className="wordmark">
          <Logo size={26} className="wordmark-logo" />proactivity{' '}
          <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: 18 }}>admin</span>
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link href="/admin/moderate" className="admin-tab">Moderation</Link>
          <Link href="/admin/events" className="admin-tab">Events</Link>
          <Link href="/admin/organizations" className="admin-tab">Orgs</Link>
          <Link href="/admin/area-requests" className="admin-tab admin-tab-active">Areas</Link>
          <Link href="/admin/api-keys" className="admin-tab">Keys</Link>
          <button type="button" className="admin-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-label">Total requests</span>
          <span className="admin-stat-value">{items.length}</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Pending</span>
          <span className="admin-stat-value">{items.filter((r) => r.status === 'requested').length}</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Unique regions</span>
          <span className="admin-stat-value">{clusters.length}</span>
        </div>
      </div>

      {error && <div className="error">Failed to load: {error}</div>}
      {loading && items.length === 0 && <p className="admin-empty">Loading…</p>}
      {!loading && items.length === 0 && <p className="admin-empty">No area requests yet.</p>}

      {clusters.map((c) => (
        <section key={c.key} className="admin-section">
          <h2 className="admin-section-title">
            {c.regionDisplay}
            <span className="admin-section-count">{c.reqs.length}</span>
            {c.totalCommitted > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-muted)', fontWeight: 400 }}>
                · {c.totalCommitted} events committed total
              </span>
            )}
          </h2>
          <div className="admin-list">
            {c.reqs.map((r) => (
              <article key={r.id} className="admin-card" style={{ opacity: r.status === 'requested' ? 1 : 0.6 }}>
                <div className="admin-card-head">
                  <span className="admin-card-from">
                    {r.name ?? '(no name)'}{' '}
                    <a href={`mailto:${r.email}`} className="admin-card-email">&lt;{r.email}&gt;</a>
                  </span>
                  <span className="admin-card-meta">{new Date(r.createdAt).toLocaleString()}</span>
                </div>
                <p className="admin-card-context">
                  <strong>{r.regionText}</strong>
                  {r.lat != null && r.lng != null && (
                    <span style={{ marginLeft: 8, color: 'var(--fg-muted)', fontSize: 12, fontFamily: 'monospace' }}>
                      {r.lat.toFixed(3)}, {r.lng.toFixed(3)}
                    </span>
                  )}
                  <span className={`badge organizer-status-badge organizer-status-${r.status === 'launched' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'}`} style={{ marginLeft: 8 }}>
                    {r.status}
                  </span>
                </p>
                <p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '4px 0 0' }}>
                  Relationship: {r.relationship ?? '—'}
                  {r.committedEventCount != null && <> · Committed: <strong>{r.committedEventCount}</strong> events</>}
                </p>
                {r.moderatorNote && (
                  <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6, fontStyle: 'italic' }}>
                    Mod note: {r.moderatorNote}
                  </p>
                )}
                {r.status === 'requested' && (
                  <div className="admin-card-actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn-approve"
                      onClick={() => moderate(r.id, 'launch')}
                      disabled={busyId === r.id}
                    >Mark launched</button>
                    <button
                      type="button"
                      className="admin-btn admin-btn-reject"
                      onClick={() => moderate(r.id, 'reject')}
                      disabled={busyId === r.id}
                    >Reject</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
