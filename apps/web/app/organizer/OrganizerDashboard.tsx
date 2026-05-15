'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Logo } from '../Logo';
import { describeRecurrence, generateOccurrences } from '../../lib/recurrence';

interface Claim {
  id: string;
  organizerKey: string;
  organizerName: string | null;
  organizerUrl: string | null;
  userCreated: boolean;
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

interface UrlSubmission {
  id: string;
  url: string;
  organizerKey: string | null;
  note: string | null;
  status: 'pending' | 'imported' | 'rejected' | 'failed';
  moderatorNote: string | null;
  importedCount: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface Organization {
  key: string;
  name: string | null;
  url: string | null;
  eventCount: number;
  totalClicks: number;
}

interface OrgEvent {
  id: string;
  title: string;
  startAt: string;
  venueName: string | null;
  city: string | null;
  url: string | null;
  availability: string;
  organizerKey: string;
  manualOverride: boolean;
}

interface DraftSummary {
  id: string;
  organizerKey: string;
  activityId: string | null;
  title: string | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  status: 'pending' | 'approved' | 'rejected';
  moderatorNote: string | null;
  createdAt: string;
  recurrenceFreq: string | null;
  recurrenceCount: number | null;
  recurrenceSkipDates: string[] | null;
}

const FREE_TIER_CLICK_LIMIT = 100;

export default function OrganizerDashboard() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [noAdsActive, setNoAdsActive] = useState(false);
  const [orgProActive, setOrgProActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

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
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => { setShowCreateForm((v) => !v); setShowClaimForm(false); }}
              style={{ marginTop: 0, padding: '8px 14px', fontSize: 13 }}
            >
              {showCreateForm ? 'Cancel' : '+ Create new'}
            </button>
            <button
              type="button"
              className="admin-tab"
              onClick={() => { setShowClaimForm((v) => !v); setShowCreateForm(false); }}
              style={{ marginTop: 0, padding: '8px 14px', fontSize: 13 }}
            >
              {showClaimForm ? 'Cancel' : 'Claim existing'}
            </button>
          </span>
        </h2>

        {showCreateForm && <CreateOrgForm onDone={() => { setShowCreateForm(false); load(); }} />}
        {showClaimForm && <ClaimForm onDone={() => { setShowClaimForm(false); load(); }} />}

        {!loading && claims.length === 0 && !showClaimForm && !showCreateForm && (
          <p className="admin-empty">No organizations yet. Click "+ Create new" to add one, or "Claim existing" if your org already has events in Proactivity.</p>
        )}

        <div className="organizer-list">
          {[...approvedClaims, ...pendingClaims, ...rejectedClaims].map((c) => (
            <article
              key={c.id}
              className={`organizer-card organizer-card-${c.status}`}
            >
              <div className="organizer-card-head">
                <strong>{c.organizerName ?? c.organizerKey}</strong>
                {c.userCreated && <span className="admin-tag" style={{ fontSize: 10 }}>user-created</span>}
                <span className={`badge organizer-status-badge organizer-status-${c.status}`}>
                  {c.status}
                </span>
              </div>
              {c.organizerUrl && (
                <div style={{ fontSize: 12 }}>
                  <a href={c.organizerUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--fg-muted)' }}>
                    {c.organizerUrl}
                  </a>
                </div>
              )}
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

      {approvedClaims.length > 0 && (
        <EventsSection approvedClaims={approvedClaims} />
      )}

      {approvedClaims.length > 0 && (
        <UrlSubmissionsSection approvedClaims={approvedClaims} />
      )}

      {noAdsActive && (
        <p style={{ marginTop: 24, color: 'var(--fg-muted)', fontSize: 12 }}>
          You also have Proactivity Plus (ad-free) active.
        </p>
      )}
    </main>
  );
}

/**
 * Per-organizer events management — list existing events with "Edit"
 * actions and a button to submit a brand-new event draft. All changes go
 * through admin moderation; this section also shows pending drafts.
 */
function EventsSection({ approvedClaims }: { approvedClaims: Claim[] }) {
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null); // organizerKey
  const [editing, setEditing] = useState<OrgEvent | null>(null);
  // When non-null, opens the Add form pre-filled from this event.
  const [copyFrom, setCopyFrom] = useState<OrgEvent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/organizer/events').then((r) => r.json());
    setEvents(res.events ?? []);
    setDrafts(res.drafts ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const pendingDraftForActivity = (activityId: string) =>
    drafts.find((d) => d.activityId === activityId && d.status === 'pending');

  return (
    <section className="admin-section">
      <h2 className="admin-section-title">
        Your events <span className="admin-section-count">{loading ? '…' : events.length}</span>
      </h2>
      <p className="onboarding-sub" style={{ marginTop: -6, marginBottom: 16 }}>
        Add new events or edit existing ones. All changes are reviewed by an admin before going live.
      </p>

      {drafts.filter((d) => d.status === 'pending').length > 0 && (
        <div className="organizer-pending-banner">
          <div>
            You have {drafts.filter((d) => d.status === 'pending').length} pending change{drafts.filter((d) => d.status === 'pending').length === 1 ? '' : 's'} awaiting admin review.
          </div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
            {drafts.filter((d) => d.status === 'pending').map((d) => (
              <li key={d.id}>
                {d.title ?? '(new event)'}
                {d.recurrenceFreq && d.recurrenceCount && (
                  <span style={{ marginLeft: 6, color: 'var(--accent)' }}>
                    · {describeRecurrence(d.recurrenceFreq, d.recurrenceCount, d.recurrenceSkipDates?.length ?? 0)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {approvedClaims.map((c) => {
        const orgEvents = events.filter((e) => e.organizerKey === c.organizerKey);
        return (
          <div key={c.organizerKey} className="organizer-events-block">
            <div className="organizer-events-head">
              <strong>{c.organizerName ?? c.organizerKey}</strong>
              <button
                type="button"
                className="btn-primary"
                onClick={() => { setAdding(c.organizerKey); setEditing(null); }}
                style={{ marginTop: 0, padding: '6px 12px', fontSize: 12 }}
              >
                + Add event
              </button>
            </div>
            {orgEvents.length === 0 && (
              <p className="admin-empty" style={{ marginTop: 4 }}>No events yet for this organizer.</p>
            )}
            <div className="organizer-event-list">
              {orgEvents.map((e) => {
                const pending = pendingDraftForActivity(e.id);
                return (
                  <div key={e.id} className="organizer-event-row">
                    <div>
                      <div style={{ fontWeight: 500 }}>{e.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {new Date(e.startAt).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', year: 'numeric',
                          hour: 'numeric', minute: '2-digit',
                        })}
                        {e.venueName && ` · ${e.venueName}`}
                        {e.manualOverride && <span className="admin-tag" style={{ marginLeft: 6 }}>edited</span>}
                      </div>
                      {pending && (
                        <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
                          ⏳ Edit pending review
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="admin-tab"
                        onClick={() => { setCopyFrom(e); setAdding(e.organizerKey); setEditing(null); }}
                        style={{ fontSize: 12 }}
                        title="Create a new event pre-filled from this one"
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        className="admin-tab"
                        onClick={() => { setEditing(e); setAdding(null); setCopyFrom(null); }}
                        style={{ fontSize: 12 }}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {drafts.filter((d) => d.status === 'rejected').length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--fg-muted)' }}>
            Recent rejections ({drafts.filter((d) => d.status === 'rejected').length})
          </summary>
          <div style={{ marginTop: 8, fontSize: 12 }}>
            {drafts.filter((d) => d.status === 'rejected').slice(0, 10).map((d) => (
              <div key={d.id} style={{ padding: 8, borderLeft: '2px solid var(--danger-fg, #c44)', marginBottom: 6 }}>
                <div>
                  {d.title ?? '(new event)'}
                  {d.recurrenceFreq && d.recurrenceCount && (
                    <span style={{ marginLeft: 6, color: 'var(--fg-muted)', fontSize: 11 }}>
                      · {describeRecurrence(d.recurrenceFreq, d.recurrenceCount, d.recurrenceSkipDates?.length ?? 0)}
                    </span>
                  )}
                </div>
                {d.moderatorNote && <div style={{ color: 'var(--fg-muted)' }}>Note: {d.moderatorNote}</div>}
              </div>
            ))}
          </div>
        </details>
      )}

      {(adding || editing) && (
        <DraftForm
          mode={editing ? 'edit' : 'new'}
          organizerKey={adding ?? editing!.organizerKey}
          activityId={editing?.id ?? null}
          copyFromActivityId={copyFrom?.id ?? null}
          onClose={() => { setAdding(null); setEditing(null); setCopyFrom(null); }}
          onSubmitted={() => { setAdding(null); setEditing(null); setCopyFrom(null); load(); }}
        />
      )}
    </section>
  );
}

interface DraftFormValues {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  url: string;
  imageUrl: string;
  venueName: string;
  address: string;
  city: string;
  region: string;
  organizerName: string;
  organizerUrl: string;
  costMin: string;
  costMax: string;
  availability: string;
  categories: string;
  recurrenceFreq: string;   // '' | 'weekly' | 'biweekly' | 'monthly'
  recurrenceCount: string;
  recurrenceSkipDates: string;
}

const EMPTY_VALUES: DraftFormValues = {
  title: '', description: '', startAt: '', endAt: '', url: '', imageUrl: '',
  venueName: '', address: '', city: '', region: '',
  organizerName: '', organizerUrl: '',
  costMin: '', costMax: '', availability: 'onsale', categories: '',
  recurrenceFreq: '', recurrenceCount: '4', recurrenceSkipDates: '',
};

function shiftDateByDays(local: string, days: number): string {
  if (!local) return local;
  // local is a YYYY-MM-DDTHH:mm string from datetime-local input.
  const d = new Date(local);
  if (isNaN(d.getTime())) return local;
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DraftForm({
  mode,
  organizerKey,
  activityId,
  copyFromActivityId,
  onClose,
  onSubmitted,
}: {
  mode: 'new' | 'edit';
  organizerKey: string;
  activityId: string | null;
  copyFromActivityId: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [values, setValues] = useState<DraftFormValues>(EMPTY_VALUES);
  const [loading, setLoading] = useState(mode === 'edit' || !!copyFromActivityId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchId = activityId ?? copyFromActivityId;
    if (!fetchId) return;
    fetch(`/api/organizer/events/${fetchId}`)
      .then((r) => r.json() as Promise<{ event?: Record<string, unknown>; error?: string }>)
      .then((d) => {
        if (!d.event) throw new Error(d.error ?? 'Failed to load');
        const e = d.event as {
          title: string; description: string | null; startAt: string; endAt: string | null;
          url: string | null; imageUrl: string | null; venueName: string | null;
          address: string | null; city: string | null; region: string | null;
          organizerName: string | null; organizerUrl: string | null;
          costMinCents: number | null; costMaxCents: number | null;
          availability: string; categories: string[] | null;
        };
        // When copying, shift the start/end forward by 7 days so the user
        // doesn't accidentally re-submit the same date.
        const isCopy = mode === 'new' && !!copyFromActivityId;
        const startLocal = toLocalDateTime(e.startAt);
        const endLocal = toLocalDateTime(e.endAt);
        setValues({
          title: isCopy ? e.title : e.title,
          description: e.description ?? '',
          startAt: isCopy ? shiftDateByDays(startLocal, 7) : startLocal,
          endAt: isCopy ? shiftDateByDays(endLocal, 7) : endLocal,
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
          availability: e.availability,
          categories: e.categories?.join(', ') ?? '',
          recurrenceFreq: '',
          recurrenceCount: '4',
          recurrenceSkipDates: '',
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [mode, activityId, copyFromActivityId]);

  const set = (name: keyof DraftFormValues, v: string) =>
    setValues((prev) => ({ ...prev, [name]: v }));

  // Live preview of the generated occurrence dates for the recurrence form.
  // Mirrors what the server will do at approval time.
  const occurrencePreview = useMemo(() => {
    if (mode !== 'new' || !values.recurrenceFreq || !values.startAt) return null;
    const start = new Date(values.startAt);
    if (isNaN(start.getTime())) return null;
    const end = values.endAt ? new Date(values.endAt) : null;
    const count = Number(values.recurrenceCount);
    if (!Number.isInteger(count) || count < 2 || count > 52) return null;
    const skip = values.recurrenceSkipDates
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    return generateOccurrences(start, end && !isNaN(end.getTime()) ? end : null, values.recurrenceFreq, count, skip);
  }, [mode, values.recurrenceFreq, values.recurrenceCount, values.recurrenceSkipDates, values.startAt, values.endAt]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!values.title.trim()) { setError('Title is required.'); return; }
    if (!values.startAt) { setError('Start date/time is required.'); return; }
    setSubmitting(true);
    try {
      const payload = { ...values, organizerKey };
      const url = mode === 'edit' && activityId
        ? `/api/organizer/events/${activityId}`
        : '/api/organizer/events';
      const method = mode === 'edit' ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="onboarding-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="onboarding-card draft-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="onboarding-title">
          {mode === 'edit' ? 'Propose an edit' : copyFromActivityId ? 'Copy event' : 'Submit a new event'}
        </h2>
        <p className="onboarding-sub" style={{ marginBottom: 14 }}>
          An admin will review your {mode === 'edit' ? 'changes' : 'submission'} before it goes live.
        </p>

        {loading ? (
          <p>Loading…</p>
        ) : (
          <form onSubmit={submit} className="add-event-form">
            <div className="add-event-field add-event-field-full">
              <label>Title *</label>
              <input value={values.title} onChange={(e) => set('title', e.target.value)} required />
            </div>
            <div className="add-event-field add-event-field-full">
              <label>Description</label>
              <textarea rows={3} value={values.description} onChange={(e) => set('description', e.target.value)} />
            </div>
            <div className="add-event-field">
              <label>Start *</label>
              <input type="datetime-local" value={values.startAt} onChange={(e) => set('startAt', e.target.value)} required />
            </div>
            <div className="add-event-field">
              <label>End</label>
              <input type="datetime-local" value={values.endAt} onChange={(e) => set('endAt', e.target.value)} />
            </div>
            <div className="add-event-field">
              <label>Event URL</label>
              <input type="url" value={values.url} onChange={(e) => set('url', e.target.value)} />
            </div>
            <div className="add-event-field">
              <label>Image URL</label>
              <input type="url" value={values.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} />
            </div>
            <div className="add-event-field">
              <label>Venue</label>
              <input value={values.venueName} onChange={(e) => set('venueName', e.target.value)} />
            </div>
            <div className="add-event-field">
              <label>Address</label>
              <input value={values.address} onChange={(e) => set('address', e.target.value)} />
            </div>
            <div className="add-event-field">
              <label>City</label>
              <input value={values.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div className="add-event-field">
              <label>State</label>
              <input value={values.region} onChange={(e) => set('region', e.target.value)} />
            </div>
            <div className="add-event-field">
              <label>Cost min ($)</label>
              <input inputMode="decimal" value={values.costMin} onChange={(e) => set('costMin', e.target.value)} />
            </div>
            <div className="add-event-field">
              <label>Cost max ($)</label>
              <input inputMode="decimal" value={values.costMax} onChange={(e) => set('costMax', e.target.value)} />
            </div>
            <div className="add-event-field">
              <label>Availability</label>
              <select value={values.availability} onChange={(e) => set('availability', e.target.value)}>
                <option value="onsale">On sale</option>
                <option value="free">Free</option>
                <option value="dropin">Drop-in</option>
                <option value="sold_out">Sold out</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="add-event-field add-event-field-full">
              <label>Categories (comma-separated)</label>
              <input value={values.categories} onChange={(e) => set('categories', e.target.value)} placeholder="music, family, outdoor" />
            </div>

            {mode === 'new' && (
              <div className="add-event-field add-event-field-full draft-recurrence">
                <label>Recurrence</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    value={values.recurrenceFreq}
                    onChange={(e) => set('recurrenceFreq', e.target.value)}
                    style={{ flex: '0 0 auto' }}
                  >
                    <option value="">Doesn't repeat</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  {values.recurrenceFreq && (
                    <>
                      <label style={{ fontSize: 12, color: 'var(--fg-muted)', textTransform: 'none', letterSpacing: 0 }}>
                        for
                      </label>
                      <input
                        type="number"
                        min={2}
                        max={52}
                        value={values.recurrenceCount}
                        onChange={(e) => set('recurrenceCount', e.target.value)}
                        style={{ width: 70 }}
                      />
                      <label style={{ fontSize: 12, color: 'var(--fg-muted)', textTransform: 'none', letterSpacing: 0 }}>
                        occurrences
                      </label>
                    </>
                  )}
                </div>
                {values.recurrenceFreq && (
                  <>
                    <label style={{ marginTop: 6, fontSize: 11 }}>Skip dates (optional)</label>
                    <input
                      value={values.recurrenceSkipDates}
                      onChange={(e) => set('recurrenceSkipDates', e.target.value)}
                      placeholder="2026-07-04, 2026-12-25"
                    />
                    <p className="add-event-hint">Comma-separated YYYY-MM-DD dates to skip (holidays, closures).</p>
                  </>
                )}
                {occurrencePreview && occurrencePreview.length > 0 && (
                  <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-subtle, #f6f6f7)', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4 }}>
                      Will create {occurrencePreview.length} event{occurrencePreview.length === 1 ? '' : 's'}:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, maxHeight: 140, overflowY: 'auto' }}>
                      {occurrencePreview.map((occ) => (
                        <li key={occ.dateKey}>
                          {occ.start.toLocaleString(undefined, {
                            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                            hour: 'numeric', minute: '2-digit',
                          })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {error && <p className="rating-error" style={{ gridColumn: '1 / -1' }}>{error}</p>}

            <div className="add-event-actions">
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Submitting…' : mode === 'edit' ? 'Submit edit for review' : 'Submit event for review'}
              </button>
              <button type="button" className="onboarding-skip" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Create a brand-new organization. Auto-approves the claim — admin doesn't
 * gate org creation, but the event drafts submitted under this org still go
 * through moderation.
 */
function CreateOrgForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/organizer/create-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim() || undefined }),
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
      <p style={{ fontSize: 13, color: 'var(--fg-muted)', margin: '0 0 8px' }}>
        Create a new organization that doesn't exist in Proactivity yet. You'll
        be able to submit events for it immediately (admin still reviews each
        event).
      </p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Organization name *"
        className="rating-input"
        maxLength={200}
      />
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Website URL (optional)"
        className="rating-input"
      />
      {error && <p className="rating-error">{error}</p>}
      <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
        {submitting ? 'Creating…' : 'Create organization'}
      </button>
    </div>
  );
}

/**
 * URL submissions: an organizer pastes a URL (event page, listing, calendar)
 * and admin pulls events from it manually. The submission queue keeps the
 * organizer informed about status (pending / imported with count / rejected
 * with reason).
 */
function UrlSubmissionsSection({ approvedClaims }: { approvedClaims: Claim[] }) {
  const [submissions, setSubmissions] = useState<UrlSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/organizer/url-submissions').then((r) => r.json());
    setSubmissions(res.submissions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const keyToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of approvedClaims) m.set(c.organizerKey, c.organizerName ?? c.organizerKey);
    return m;
  }, [approvedClaims]);

  return (
    <section className="admin-section">
      <h2 className="admin-section-title">
        URLs to scrape <span className="admin-section-count">{loading ? '…' : submissions.length}</span>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowForm((v) => !v)}
          style={{ marginLeft: 'auto', marginTop: 0, padding: '8px 14px', fontSize: 13 }}
        >
          {showForm ? 'Cancel' : '+ Submit a URL'}
        </button>
      </h2>
      <p className="onboarding-sub" style={{ marginTop: -6, marginBottom: 12 }}>
        Paste a page that lists your events (event detail page, calendar, season schedule).
        Admin will try to pull events from it and let you know how it went.
      </p>

      {showForm && (
        <UrlSubmissionForm
          approvedClaims={approvedClaims}
          onDone={() => { setShowForm(false); load(); }}
        />
      )}

      {!loading && submissions.length === 0 && !showForm && (
        <p className="admin-empty">No URL submissions yet.</p>
      )}

      <div className="organizer-event-list">
        {submissions.map((s) => (
          <div key={s.id} className="organizer-event-row">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`badge organizer-status-badge organizer-status-${s.status === 'imported' ? 'approved' : s.status === 'pending' ? 'pending' : 'rejected'}`}>
                  {s.status}
                </span>
                {s.organizerKey && (
                  <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                    {keyToName.get(s.organizerKey) ?? s.organizerKey}
                  </span>
                )}
                {s.importedCount != null && (
                  <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                    · {s.importedCount} event{s.importedCount === 1 ? '' : 's'} imported
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <a href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
              </div>
              {s.note && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{s.note}</div>}
              {s.moderatorNote && (
                <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
                  Note: {s.moderatorNote}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function UrlSubmissionForm({
  approvedClaims, onDone,
}: { approvedClaims: Claim[]; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [organizerKey, setOrganizerKey] = useState(approvedClaims[0]?.organizerKey ?? '');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!url.trim()) { setError('URL is required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/organizer/url-submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          organizerKey: organizerKey || undefined,
          note: note.trim() || undefined,
        }),
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
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/events *"
        className="rating-input"
      />
      {approvedClaims.length > 0 && (
        <select
          value={organizerKey}
          onChange={(e) => setOrganizerKey(e.target.value)}
          className="rating-input"
        >
          <option value="">(no specific organizer)</option>
          {approvedClaims.map((c) => (
            <option key={c.organizerKey} value={c.organizerKey}>
              {c.organizerName ?? c.organizerKey}
            </option>
          ))}
        </select>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything helpful to know? (e.g., 'season schedule page; ignore tournaments')"
        rows={3}
        className="rating-review"
      />
      {error && <p className="rating-error">{error}</p>}
      <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit URL'}
      </button>
    </div>
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
