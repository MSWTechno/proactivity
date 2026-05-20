'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '../../Logo';
import { AreaRequestsBadge } from '../_components/AreaRequestsBadge';

interface Event {
  id: string;
  title: string;
  startAt: string;
  organizerName: string | null;
  organizerUrl: string | null;
  city: string | null;
  region: string | null;
  url: string | null;
  clickCount: number;
  availability: string;
  isVirtual: boolean;
}

type SortField = 'clicks' | 'start' | 'title';

export default function EventsTable() {
  const router = useRouter();
  const [items, setItems] = useState<Event[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [totalClicks, setTotalClicks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sort, setSort] = useState<SortField>('clicks');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [debouncedOrganizer, setDebouncedOrganizer] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedOrganizer(organizer.trim()), 250);
    return () => clearTimeout(t);
  }, [organizer]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedSearch) p.set('search', debouncedSearch);
    if (debouncedOrganizer) p.set('organizer', debouncedOrganizer);
    if (startDate) p.set('start', startDate);
    if (endDate) p.set('end', endDate);
    p.set('sort', sort);
    p.set('dir', dir);
    p.set('limit', '200');
    return p.toString();
  }, [debouncedSearch, debouncedOrganizer, startDate, endDate, sort, dir]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/events?${queryString}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ items: Event[]; totalEvents: number; totalClicks: number }>;
      })
      .then((data) => {
        setItems(data.items);
        setTotalEvents(data.totalEvents);
        setTotalClicks(data.totalClicks);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [queryString]);

  const toggleSort = useCallback((field: SortField) => {
    if (sort === field) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(field);
      setDir(field === 'clicks' ? 'desc' : 'asc');
    }
  }, [sort]);

  const sortIndicator = (field: SortField) => {
    if (sort !== field) return '';
    return dir === 'desc' ? ' ↓' : ' ↑';
  };

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.replace('/admin/login');
  };

  const deleteEvent = async (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This can't be undone. If it came from an ingested source it may reappear on the next cron run.`)) {
      return;
    }
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/events/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setItems((xs) => xs.filter((x) => x.id !== id));
      setTotalEvents((n) => Math.max(0, n - 1));
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="admin-main">
      <header className="admin-header">
        <h1 className="wordmark">
          <Logo size={26} className="wordmark-logo" />proactivity{' '}
          <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: 18 }}>admin</span>
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link href="/admin/moderate" className="admin-tab">Moderation</Link>
          <Link href="/admin/events" className="admin-tab admin-tab-active">Events</Link>
          <Link href="/admin/organizations" className="admin-tab">Orgs</Link>
          <Link href="/admin/area-requests" className="admin-tab">Areas<AreaRequestsBadge /></Link>
          <Link href="/admin/sources" className="admin-tab">Sources</Link>
          <Link href="/admin/venue-geocodes" className="admin-tab">Geocodes</Link>
          <Link href="/admin/api-keys" className="admin-tab">Keys</Link>
          <button type="button" className="admin-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-label">Events</span>
          <span className="admin-stat-value">{totalEvents}</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Total clicks</span>
          <span className="admin-stat-value">{totalClicks}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <Link href="/admin/events/new" className="btn-primary" style={{ marginTop: 0, padding: '10px 18px', textDecoration: 'none' }}>
            + Add event
          </Link>
        </div>
      </div>

      <div className="admin-filters">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title…"
          className="rating-input"
        />
        <input
          type="search"
          value={organizer}
          onChange={(e) => setOrganizer(e.target.value)}
          placeholder="Organizer name…"
          className="rating-input"
        />
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rating-input"
          title="Start date (from)"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="rating-input"
          title="Start date (until)"
        />
      </div>

      {error && <div className="error">Failed to load: {error}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th><button type="button" onClick={() => toggleSort('title')}>Event{sortIndicator('title')}</button></th>
            <th><button type="button" onClick={() => toggleSort('start')}>Date{sortIndicator('start')}</button></th>
            <th>Organizer</th>
            <th>Location</th>
            <th className="admin-th-right"><button type="button" onClick={() => toggleSort('clicks')}>Clicks{sortIndicator('clicks')}</button></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading && items.length === 0 && (
            <tr><td colSpan={6} className="admin-empty-row">Loading…</td></tr>
          )}
          {!loading && items.length === 0 && (
            <tr><td colSpan={6} className="admin-empty-row">No matching events.</td></tr>
          )}
          {items.map((e) => (
            <tr key={e.id}>
              <td>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer">{e.title}</a>
                ) : (
                  e.title
                )}
                {e.isVirtual && <span className="admin-tag">virtual</span>}
              </td>
              <td className="admin-td-nowrap">
                {new Date(e.startAt).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', year: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })}
              </td>
              <td>
                {e.organizerUrl ? (
                  <a href={e.organizerUrl} target="_blank" rel="noreferrer">{e.organizerName ?? '—'}</a>
                ) : (
                  e.organizerName ?? <span style={{ color: 'var(--fg-subtle)' }}>—</span>
                )}
              </td>
              <td>{[e.city, e.region].filter(Boolean).join(', ') || <span style={{ color: 'var(--fg-subtle)' }}>—</span>}</td>
              <td className="admin-td-right admin-clicks">{e.clickCount}</td>
              <td className="admin-td-right">
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <Link href={`/admin/events/${e.id}/edit`} className="admin-tab" style={{ fontSize: 12 }}>Edit</Link>
                  <button
                    type="button"
                    className="admin-tab admin-btn-reject"
                    onClick={() => deleteEvent(e.id, e.title)}
                    disabled={deletingId === e.id}
                    style={{ fontSize: 12 }}
                  >
                    {deletingId === e.id ? 'Deleting…' : 'Delete'}
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
