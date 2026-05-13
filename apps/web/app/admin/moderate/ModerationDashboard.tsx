'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface PendingRating {
  id: string;
  targetKind: string;
  targetKey: string;
  score: number;
  review: string | null;
  submitterName: string | null;
  submitterEmail: string | null;
  createdAt: string;
  activityTitle: string | null;
  activityUrl: string | null;
  organizerName: string | null;
  organizerUrl: string | null;
}
interface NewSubmission {
  id: string;
  name: string | null;
  email: string;
  organization: string | null;
  message: string;
  eventUrl: string | null;
  createdAt: string;
}

export default function ModerationDashboard() {
  const router = useRouter();
  const [ratings, setRatings] = useState<PendingRating[]>([]);
  const [submissions, setSubmissions] = useState<NewSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/queue');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { ratings: PendingRating[]; submissions: NewSubmission[] };
      setRatings(data.ratings);
      setSubmissions(data.submissions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const moderateRating = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/ratings/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRatings((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  const resolveSubmission = async (id: string, status: 'replied' | 'added' | 'rejected') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/contact/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubmissions((ss) => ss.filter((s) => s.id !== id));
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.replace('/admin/login');
    router.refresh();
  };

  return (
    <main className="admin-main">
      <header className="admin-header">
        <h1 className="wordmark">
          <span className="dot" aria-hidden="true" />proactivity <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: 18 }}>admin</span>
        </h1>
        <button type="button" className="admin-logout" onClick={logout}>Sign out</button>
      </header>

      {error && <div className="error">Failed to load: {error}</div>}

      <section className="admin-section">
        <h2 className="admin-section-title">
          Pending ratings <span className="admin-section-count">{loading ? '…' : ratings.length}</span>
        </h2>
        {!loading && ratings.length === 0 && (
          <p className="admin-empty">Nothing to review.</p>
        )}
        <div className="admin-list">
          {ratings.map((r) => (
            <article key={r.id} className="admin-card">
              <div className="admin-card-head">
                <span className="admin-stars">{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)}</span>
                <span className="admin-card-meta">
                  {r.targetKind === 'organizer' ? 'Organizer' : 'Event'} · {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="admin-card-context">
                {r.targetKind === 'organizer'
                  ? <>For <strong>{r.organizerName ?? r.targetKey}</strong></>
                  : <>For <strong>{r.activityTitle ?? r.targetKey}</strong></>}
              </p>
              {r.review && <p className="admin-card-review">"{r.review}"</p>}
              {(r.submitterName || r.submitterEmail) && (
                <p className="admin-card-submitter">
                  {r.submitterName ?? 'anonymous'}{r.submitterEmail ? ` <${r.submitterEmail}>` : ''}
                </p>
              )}
              <div className="admin-card-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn-approve"
                  disabled={busyId === r.id}
                  onClick={() => moderateRating(r.id, 'approve')}
                >Approve</button>
                <button
                  type="button"
                  className="admin-btn admin-btn-reject"
                  disabled={busyId === r.id}
                  onClick={() => moderateRating(r.id, 'reject')}
                >Reject</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">
          New event submissions <span className="admin-section-count">{loading ? '…' : submissions.length}</span>
        </h2>
        {!loading && submissions.length === 0 && (
          <p className="admin-empty">Nothing to review.</p>
        )}
        <div className="admin-list">
          {submissions.map((s) => (
            <article key={s.id} className="admin-card">
              <div className="admin-card-head">
                <span className="admin-card-from">
                  {s.name ?? '(no name)'}{' '}
                  <a href={`mailto:${s.email}`} className="admin-card-email">&lt;{s.email}&gt;</a>
                </span>
                <span className="admin-card-meta">{new Date(s.createdAt).toLocaleString()}</span>
              </div>
              {s.organization && <p className="admin-card-context"><strong>{s.organization}</strong></p>}
              {s.eventUrl && (
                <p className="admin-card-context">
                  <a href={s.eventUrl} target="_blank" rel="noreferrer">{s.eventUrl}</a>
                </p>
              )}
              <p className="admin-card-review">{s.message}</p>
              <div className="admin-card-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn-approve"
                  disabled={busyId === s.id}
                  onClick={() => resolveSubmission(s.id, 'added')}
                >Mark added</button>
                <button
                  type="button"
                  className="admin-btn"
                  disabled={busyId === s.id}
                  onClick={() => resolveSubmission(s.id, 'replied')}
                >Mark replied</button>
                <button
                  type="button"
                  className="admin-btn admin-btn-reject"
                  disabled={busyId === s.id}
                  onClick={() => resolveSubmission(s.id, 'rejected')}
                >Reject</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
