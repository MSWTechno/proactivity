'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '../../Logo';
import { generateOccurrences } from '../../../lib/recurrence';

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
  eventData: SubmissionEventData | null;
  wantsOrgClaim: boolean;
  createdAt: string;
}

interface SubmissionEventData {
  title?: string;
  description?: string | null;
  startAt?: string;
  endAt?: string | null;
  venueName?: string;
  address?: string;
  city?: string | null;
  region?: string | null;
  imageUrl?: string | null;
  costMin?: number | null;
  costMax?: number | null;
  ageMin?: number | null;
  ageMax?: number | null;
  categories?: string | null;
  claimedOrganizerKey?: string | null;
}
interface PendingClaim {
  id: string;
  organizerKey: string;
  organizerName: string | null;
  note: string | null;
  userEmail: string | null;
  userName: string | null;
  eventCount: number;
  createdAt: string;
}

interface DraftFields {
  title: string | null;
  description: string | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  venueName: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  costMinCents: number | null;
  costMaxCents: number | null;
  availability: string | null;
  organizerName: string | null;
  organizerUrl: string | null;
  url: string | null;
  imageUrl: string | null;
  categories: string[] | null;
}

interface PendingDraft {
  id: string;
  organizerKey: string;
  activityId: string | null;
  submitter: { email: string | null; name: string | null };
  proposed: DraftFields;
  existing: DraftFields | null;
  recurrence: { freq: string; count: number; skipDates: string[] } | null;
  createdAt: string;
}

interface UrlSubmission {
  id: string;
  url: string;
  organizerKey: string | null;
  note: string | null;
  status: string;
  importedCount: number | null;
  moderatorNote: string | null;
  createdAt: string;
  submitter: { email: string | null; name: string | null };
}

export default function ModerationDashboard() {
  const router = useRouter();
  const [ratings, setRatings] = useState<PendingRating[]>([]);
  const [submissions, setSubmissions] = useState<NewSubmission[]>([]);
  const [claims, setClaims] = useState<PendingClaim[]>([]);
  const [drafts, setDrafts] = useState<PendingDraft[]>([]);
  const [urlSubmissions, setUrlSubmissions] = useState<UrlSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [queueRes, draftRes, urlRes] = await Promise.all([
        fetch('/api/admin/queue'),
        fetch('/api/admin/event-drafts'),
        fetch('/api/admin/url-submissions'),
      ]);
      if (!queueRes.ok) throw new Error(`HTTP ${queueRes.status}`);
      const data = (await queueRes.json()) as {
        ratings: PendingRating[];
        submissions: NewSubmission[];
        claims: PendingClaim[];
      };
      setRatings(data.ratings);
      setSubmissions(data.submissions);
      setClaims(data.claims ?? []);
      if (draftRes.ok) {
        const dd = (await draftRes.json()) as { drafts: PendingDraft[] };
        setDrafts(dd.drafts ?? []);
      }
      if (urlRes.ok) {
        const ud = (await urlRes.json()) as { submissions: UrlSubmission[] };
        setUrlSubmissions(ud.submissions ?? []);
      }
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

  const moderateClaim = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/claims/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setClaims((cs) => cs.filter((c) => c.id !== id));
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  const deleteClaim = async (c: PendingClaim) => {
    const isUserCreated = c.organizerKey.startsWith('user:');
    const warn = isUserCreated && c.eventCount > 0
      ? `Delete claim for "${c.organizerName ?? c.organizerKey}"? This will also delete ${c.eventCount} event${c.eventCount === 1 ? '' : 's'} (user-created org). This can't be undone.`
      : `Delete claim for "${c.organizerName ?? c.organizerKey}"? This can't be undone.`;
    if (!window.confirm(warn)) return;
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/admin/claims/${c.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setClaims((cs) => cs.filter((x) => x.id !== c.id));
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  const moderateDraft = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      const note = action === 'reject' ? window.prompt('Optional note for the organizer:') ?? undefined : undefined;
      const res = await fetch(`/api/admin/event-drafts/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setDrafts((ds) => ds.filter((d) => d.id !== id));
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  const resolveUrlSubmission = async (
    id: string,
    action: 'imported' | 'rejected' | 'failed',
  ) => {
    setBusyId(id);
    try {
      let importedCount: number | undefined;
      let note: string | undefined;
      if (action === 'imported') {
        const cntStr = window.prompt('How many events were imported?', '1');
        if (cntStr == null) { setBusyId(null); return; }
        const cnt = Number(cntStr);
        if (!Number.isInteger(cnt) || cnt < 0) {
          alert('Invalid count.');
          setBusyId(null);
          return;
        }
        importedCount = cnt;
      } else {
        note = window.prompt(`Optional ${action} note for the submitter:`) ?? undefined;
      }
      const res = await fetch(`/api/admin/url-submissions/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note, importedCount }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setUrlSubmissions((us) => us.filter((u) => u.id !== id));
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
          <Logo size={26} className="wordmark-logo" />proactivity <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: 18 }}>admin</span>
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link href="/admin/moderate" className="admin-tab admin-tab-active">Moderation</Link>
          <Link href="/admin/events" className="admin-tab">Events</Link>
          <Link href="/admin/organizations" className="admin-tab">Orgs</Link>
          <Link href="/admin/api-keys" className="admin-tab">Keys</Link>
          <button type="button" className="admin-logout" onClick={logout}>Sign out</button>
        </div>
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
          Organizer claims <span className="admin-section-count">{loading ? '…' : claims.length}</span>
        </h2>
        {!loading && claims.length === 0 && (
          <p className="admin-empty">Nothing to review.</p>
        )}
        <div className="admin-list">
          {claims.map((c) => (
            <article key={c.id} className="admin-card">
              <div className="admin-card-head">
                <span className="admin-card-from">
                  {c.userName ?? '(no name)'}{' '}
                  {c.userEmail && (
                    <a href={`mailto:${c.userEmail}`} className="admin-card-email">&lt;{c.userEmail}&gt;</a>
                  )}
                </span>
                <span className="admin-card-meta">{new Date(c.createdAt).toLocaleString()}</span>
              </div>
              <p className="admin-card-context">
                Claims to be: <strong>{c.organizerName ?? c.organizerKey}</strong>{' '}
                <span style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>({c.eventCount} events)</span>
              </p>
              {c.note && <p className="admin-card-review">{c.note}</p>}
              <div className="admin-card-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn-approve"
                  disabled={busyId === c.id}
                  onClick={() => moderateClaim(c.id, 'approve')}
                >Approve</button>
                <button
                  type="button"
                  className="admin-btn admin-btn-reject"
                  disabled={busyId === c.id}
                  onClick={() => moderateClaim(c.id, 'reject')}
                >Reject</button>
                <button
                  type="button"
                  className="admin-btn admin-btn-reject"
                  disabled={busyId === c.id}
                  onClick={() => deleteClaim(c)}
                  title="Hard-delete this claim (and its user-created org's events, if any)"
                >Delete</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">
          Organizer event drafts <span className="admin-section-count">{loading ? '…' : drafts.length}</span>
        </h2>
        {!loading && drafts.length === 0 && (
          <p className="admin-empty">Nothing to review.</p>
        )}
        <div className="admin-list">
          {drafts.map((d) => (
            <article key={d.id} className="admin-card">
              <div className="admin-card-head">
                <span className="admin-card-from">
                  {d.submitter.name ?? '(no name)'}{' '}
                  {d.submitter.email && (
                    <a href={`mailto:${d.submitter.email}`} className="admin-card-email">&lt;{d.submitter.email}&gt;</a>
                  )}
                </span>
                <span className="admin-card-meta">
                  {d.activityId ? 'Edit' : 'New event'} · {new Date(d.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="admin-card-context">
                <strong>{d.proposed.title ?? '(no title)'}</strong>
                {d.proposed.startAt && (
                  <> · {new Date(d.proposed.startAt).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: 'numeric', minute: '2-digit',
                  })}</>
                )}
                {d.recurrence && (
                  <> · <span style={{ color: 'var(--accent)' }}>
                    repeats {d.recurrence.freq === 'biweekly' ? 'every 2 weeks' : d.recurrence.freq} × {d.recurrence.count}
                    {d.recurrence.skipDates.length > 0 && ` (skip ${d.recurrence.skipDates.length})`}
                  </span></>
                )}
              </p>
              {d.recurrence && d.proposed.startAt && (
                <RecurrencePreview
                  startAt={d.proposed.startAt}
                  endAt={d.proposed.endAt}
                  timezone={d.proposed.timezone}
                  freq={d.recurrence.freq}
                  count={d.recurrence.count}
                  skipDates={d.recurrence.skipDates}
                />
              )}
              <DraftDiff proposed={d.proposed} existing={d.existing} />
              <div className="admin-card-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn-approve"
                  disabled={busyId === d.id}
                  onClick={() => moderateDraft(d.id, 'approve')}
                >Approve & publish</button>
                <button
                  type="button"
                  className="admin-btn admin-btn-reject"
                  disabled={busyId === d.id}
                  onClick={() => moderateDraft(d.id, 'reject')}
                >Reject</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">
          URL submissions <span className="admin-section-count">{loading ? '…' : urlSubmissions.length}</span>
        </h2>
        {!loading && urlSubmissions.length === 0 && (
          <p className="admin-empty">Nothing to review.</p>
        )}
        <div className="admin-list">
          {urlSubmissions.map((u) => (
            <article key={u.id} className="admin-card">
              <div className="admin-card-head">
                <span className="admin-card-from">
                  {u.submitter.name ?? '(no name)'}{' '}
                  {u.submitter.email && (
                    <a href={`mailto:${u.submitter.email}`} className="admin-card-email">&lt;{u.submitter.email}&gt;</a>
                  )}
                </span>
                <span className="admin-card-meta">{new Date(u.createdAt).toLocaleString()}</span>
              </div>
              <p className="admin-card-context" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <a href={u.url} target="_blank" rel="noreferrer">{u.url}</a>
              </p>
              {u.organizerKey && (
                <p className="admin-card-context" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                  For organizer: <code>{u.organizerKey}</code>
                </p>
              )}
              {u.note && <p className="admin-card-review">{u.note}</p>}
              <div className="admin-card-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn-approve"
                  disabled={busyId === u.id}
                  onClick={() => resolveUrlSubmission(u.id, 'imported')}
                >Mark imported</button>
                <button
                  type="button"
                  className="admin-btn"
                  disabled={busyId === u.id}
                  onClick={() => resolveUrlSubmission(u.id, 'failed')}
                >Mark failed</button>
                <button
                  type="button"
                  className="admin-btn admin-btn-reject"
                  disabled={busyId === u.id}
                  onClick={() => resolveUrlSubmission(u.id, 'rejected')}
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
              {s.organization && (
                <p className="admin-card-context">
                  <strong>{s.organization}</strong>
                  {s.eventData?.claimedOrganizerKey ? (
                    <span className="admin-tag" style={{ marginLeft: 8, background: 'var(--success-bg, #e0f5e9)', color: 'var(--success-fg, #1f7a3f)' }}>
                      verified organizer
                    </span>
                  ) : s.wantsOrgClaim ? (
                    <span className="admin-tag" style={{ marginLeft: 8 }}>claim requested</span>
                  ) : null}
                </p>
              )}
              {s.eventData ? (
                <SubmissionEventDataView ed={s.eventData} eventUrl={s.eventUrl} message={s.message} />
              ) : (
                <>
                  {s.eventUrl && (
                    <p className="admin-card-context">
                      <a href={s.eventUrl} target="_blank" rel="noreferrer">{s.eventUrl}</a>
                    </p>
                  )}
                  <p className="admin-card-review">{s.message}</p>
                </>
              )}
              <div className="admin-card-actions">
                <Link
                  href={`/admin/events/new?contactId=${s.id}`}
                  className="admin-btn admin-btn-approve"
                  style={{ textDecoration: 'none' }}
                >Add as event</Link>
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

function SubmissionEventDataView({
  ed,
  eventUrl,
  message,
}: {
  ed: SubmissionEventData;
  eventUrl: string | null;
  message: string;
}) {
  const start = ed.startAt ? new Date(ed.startAt) : null;
  const end = ed.endAt ? new Date(ed.endAt) : null;
  const fmt = (d: Date | null) =>
    d && !isNaN(d.getTime())
      ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : null;
  const cityRegion = [ed.city, ed.region].filter(Boolean).join(', ');
  const venueLine = [ed.venueName, ed.address, cityRegion].filter(Boolean).join(' · ');
  const cost =
    ed.costMin != null && ed.costMax != null && ed.costMax !== ed.costMin
      ? `$${ed.costMin}–$${ed.costMax}`
      : ed.costMin != null
        ? `$${ed.costMin}`
        : null;
  const ages =
    ed.ageMin != null && ed.ageMax != null
      ? `Ages ${ed.ageMin}–${ed.ageMax}`
      : ed.ageMin != null
        ? `Ages ${ed.ageMin}+`
        : ed.ageMax != null
          ? `Up to age ${ed.ageMax}`
          : null;

  return (
    <div className="admin-submission-event">
      {ed.title && <p className="admin-card-title-line"><strong>{ed.title}</strong></p>}
      {start && (
        <p className="admin-card-context">
          🗓 {fmt(start)}{end ? ` → ${fmt(end)}` : ''}
        </p>
      )}
      {venueLine && <p className="admin-card-context">📍 {venueLine}</p>}
      {eventUrl && (
        <p className="admin-card-context">
          🔗 <a href={eventUrl} target="_blank" rel="noreferrer">{eventUrl}</a>
        </p>
      )}
      {(cost || ages || ed.categories) && (
        <p className="admin-card-context" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          {[cost, ages, ed.categories].filter(Boolean).join(' · ')}
        </p>
      )}
      {ed.description && <p className="admin-card-review">{ed.description}</p>}
      {message && message !== ed.description && (
        <details style={{ margin: '4px 0', fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--fg-muted)' }}>Submitter notes</summary>
          <p className="admin-card-review" style={{ marginTop: 4 }}>{message}</p>
        </details>
      )}
    </div>
  );
}

function RecurrencePreview({
  startAt, endAt, timezone, freq, count, skipDates,
}: {
  startAt: string;
  endAt: string | null;
  timezone: string | null;
  freq: string;
  count: number;
  skipDates: string[];
}) {
  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : null;
  const occurrences = generateOccurrences(
    start,
    end && !isNaN(end.getTime()) ? end : null,
    freq, count, skipDates,
    timezone ?? 'America/New_York',
  );
  return (
    <details style={{ margin: '6px 0', fontSize: 12 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--fg-muted)' }}>
        Will create {occurrences.length} event{occurrences.length === 1 ? '' : 's'}
      </summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, maxHeight: 160, overflowY: 'auto' }}>
        {occurrences.map((occ) => (
          <li key={occ.dateKey}>
            {occ.start.toLocaleString(undefined, {
              weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit',
            })}
          </li>
        ))}
      </ul>
    </details>
  );
}

function DraftDiff({ proposed, existing }: { proposed: DraftFields; existing: DraftFields | null }) {
  // For new submissions (existing=null), just show the proposed fields as a summary.
  // For edits, show only the fields that changed.
  const FIELDS: { key: keyof DraftFields; label: string; fmt?: (v: unknown) => string }[] = [
    { key: 'title', label: 'Title' },
    { key: 'description', label: 'Description' },
    { key: 'startAt', label: 'Start', fmt: (v) => v ? new Date(v as string).toLocaleString() : '' },
    { key: 'endAt', label: 'End', fmt: (v) => v ? new Date(v as string).toLocaleString() : '' },
    { key: 'venueName', label: 'Venue' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'region', label: 'Region' },
    { key: 'costMinCents', label: 'Cost min', fmt: (v) => v == null ? '' : `$${((v as number) / 100).toFixed(2)}` },
    { key: 'costMaxCents', label: 'Cost max', fmt: (v) => v == null ? '' : `$${((v as number) / 100).toFixed(2)}` },
    { key: 'availability', label: 'Availability' },
    { key: 'url', label: 'URL' },
    { key: 'imageUrl', label: 'Image URL' },
    { key: 'organizerName', label: 'Organizer' },
    { key: 'organizerUrl', label: 'Organizer URL' },
    { key: 'categories', label: 'Categories', fmt: (v) => Array.isArray(v) ? (v as string[]).join(', ') : (v as string) ?? '' },
  ];

  const rows: { label: string; old: string; new: string }[] = [];
  for (const f of FIELDS) {
    const newVal = proposed[f.key];
    const oldVal = existing ? existing[f.key] : null;
    const newStr = f.fmt ? f.fmt(newVal) : (newVal as string) ?? '';
    const oldStr = f.fmt ? f.fmt(oldVal) : (oldVal as string) ?? '';
    if (existing == null) {
      if (newStr) rows.push({ label: f.label, old: '', new: newStr });
    } else if (newStr !== oldStr) {
      rows.push({ label: f.label, old: oldStr, new: newStr });
    }
  }

  if (rows.length === 0) {
    return <p className="admin-card-context" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>(no field changes)</p>;
  }

  return (
    <div className="draft-diff">
      {rows.map((r) => (
        <div key={r.label} className="draft-diff-row">
          <div className="draft-diff-label">{r.label}</div>
          {existing && (
            <div className="draft-diff-old">
              <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>was:</span> {r.old || <em style={{ color: 'var(--fg-subtle)' }}>(empty)</em>}
            </div>
          )}
          <div className="draft-diff-new">
            {existing && <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>new:</span>} {r.new || <em style={{ color: 'var(--fg-subtle)' }}>(empty)</em>}
          </div>
        </div>
      ))}
    </div>
  );
}
