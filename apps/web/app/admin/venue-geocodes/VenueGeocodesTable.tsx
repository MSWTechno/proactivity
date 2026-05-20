'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '../../Logo';
import { AreaRequestsBadge } from '../_components/AreaRequestsBadge';

interface Row {
  normalizedAddress: string;
  lat: number | null;
  lng: number | null;
  source: string;
  status: 'ok' | 'not_found' | 'error' | string;
  createdAt: string;
  updatedAt: string;
  activityCount: number;
}

interface Summary {
  ok: number;
  not_found: number;
  error: number;
  total: number;
}

type StatusFilter = 'all' | 'ok' | 'not_found' | 'error';

export default function VenueGeocodesTable() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary>({ ok: 0, not_found: 0, error: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('not_found');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [busyAddr, setBusyAddr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter !== 'all') p.set('status', statusFilter);
    if (debouncedSearch) p.set('search', debouncedSearch);
    return p.toString();
  }, [statusFilter, debouncedSearch]);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    fetch(`/api/admin/venue-geocodes?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { summary: Summary; geocodes: Row[] }) => {
        setSummary(d.summary);
        setRows(d.geocodes);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.replace('/admin/login');
  };

  const clearOne = async (r: Row) => {
    if (!window.confirm(`Clear cache for "${r.normalizedAddress}"? It'll re-try on the next ingest.`)) return;
    setBusyAddr(r.normalizedAddress);
    try {
      const res = await fetch('/api/admin/venue-geocodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ normalizedAddress: r.normalizedAddress, clear: true }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      load();
    } catch (e) {
      alert(`Clear failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyAddr(null);
    }
  };

  const clearAll = async (which: 'error' | 'not_found') => {
    if (!window.confirm(`Clear ALL ${which} rows? They'll re-try Nominatim on the next ingest.`)) return;
    try {
      const res = await fetch(`/api/admin/venue-geocodes?status=${which}`, { method: 'DELETE' });
      const d = (await res.json().catch(() => ({}))) as { cleared?: number; error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      alert(`Cleared ${d.cleared ?? 0} rows.`);
      load();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <main className="admin-main">
      <header className="admin-header">
        <h1 className="wordmark">
          <Logo size={26} className="wordmark-logo" />proactivity{' '}
          <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: 18 }}>admin</span>
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href="/admin/moderate" className="admin-tab">Moderation</Link>
          <Link href="/admin/events" className="admin-tab">Events</Link>
          <Link href="/admin/organizations" className="admin-tab">Orgs</Link>
          <Link href="/admin/area-requests" className="admin-tab">Areas<AreaRequestsBadge /></Link>
          <Link href="/admin/sources" className="admin-tab">Sources</Link>
          <Link href="/admin/venue-geocodes" className="admin-tab admin-tab-active">Geocodes</Link>
          <Link href="/admin/api-keys" className="admin-tab">Keys</Link>
          <button type="button" className="admin-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="admin-stats">
        <div className="admin-stat"><span className="admin-stat-label">Total</span><span className="admin-stat-value">{summary.total}</span></div>
        <div className="admin-stat"><span className="admin-stat-label">Resolved</span><span className="admin-stat-value" style={{ color: '#1f7a3f' }}>{summary.ok}</span></div>
        <div className="admin-stat"><span className="admin-stat-label">Not found</span><span className="admin-stat-value" style={{ color: '#b45309' }}>{summary.not_found}</span></div>
        <div className="admin-stat"><span className="admin-stat-label">Errors</span><span className="admin-stat-value" style={{ color: summary.error > 0 ? '#c44' : undefined }}>{summary.error}</span></div>
      </div>

      <div className="admin-filters">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search addresses…"
          className="rating-input"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rating-input"
        >
          <option value="all">All statuses</option>
          <option value="ok">Resolved</option>
          <option value="not_found">Not found</option>
          <option value="error">Error</option>
        </select>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          <button
            type="button"
            className="admin-tab"
            onClick={() => setEditing({ normalizedAddress: '', lat: null, lng: null, source: 'manual', status: 'ok', createdAt: '', updatedAt: '', activityCount: 0 })}
            style={{ fontSize: 12 }}
          >
            + Add manual entry
          </button>
          {summary.error > 0 && (
            <button type="button" className="admin-tab admin-btn-reject" onClick={() => clearAll('error')} style={{ fontSize: 12 }}>
              Retry all {summary.error} errors
            </button>
          )}
          {summary.not_found > 0 && (
            <button type="button" className="admin-tab" onClick={() => clearAll('not_found')} style={{ fontSize: 12 }}>
              Retry all not-found
            </button>
          )}
        </span>
      </div>

      {editing && (
        <ManualEntryForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {err && <div className="error">Failed to load: {err}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Address</th>
            <th>Status</th>
            <th>Coords</th>
            <th>Source</th>
            <th className="admin-th-right">Activities</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && <tr><td colSpan={7} className="admin-empty-row">Loading…</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={7} className="admin-empty-row">No rows match those filters.</td></tr>}
          {rows.map((r) => (
            <tr key={r.normalizedAddress}>
              <td style={{ fontSize: 13, wordBreak: 'break-word' }}>{r.normalizedAddress}</td>
              <td>
                <span className={`badge organizer-status-badge organizer-status-${r.status === 'ok' ? 'approved' : r.status === 'error' ? 'rejected' : 'pending'}`}>
                  {r.status}
                </span>
              </td>
              <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--fg-muted)' }}>
                {r.lat != null && r.lng != null ? `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}` : '—'}
              </td>
              <td style={{ fontSize: 12 }}>{r.source}</td>
              <td className="admin-td-right">{r.activityCount}</td>
              <td className="admin-td-nowrap" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                {new Date(r.updatedAt).toLocaleDateString()}
              </td>
              <td className="admin-td-right">
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <button
                    type="button"
                    className="admin-tab"
                    onClick={() => setEditing(r)}
                    style={{ fontSize: 12 }}
                  >
                    {r.status === 'ok' ? 'Edit' : 'Set coords'}
                  </button>
                  <button
                    type="button"
                    className="admin-tab admin-btn-reject"
                    onClick={() => clearOne(r)}
                    disabled={busyAddr === r.normalizedAddress}
                    style={{ fontSize: 12 }}
                  >
                    {busyAddr === r.normalizedAddress ? '…' : 'Clear'}
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

function ManualEntryForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: Row;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [addr, setAddr] = useState(initial.normalizedAddress);
  const [lat, setLat] = useState(initial.lat != null ? String(initial.lat) : '');
  const [lng, setLng] = useState(initial.lng != null ? String(initial.lng) : '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isExisting = !!initial.normalizedAddress;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!addr.trim()) return setError('Address required.');
    const nLat = Number(lat);
    const nLng = Number(lng);
    if (!Number.isFinite(nLat) || nLat < -90 || nLat > 90) return setError('Invalid latitude.');
    if (!Number.isFinite(nLng) || nLng < -180 || nLng > 180) return setError('Invalid longitude.');
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/venue-geocodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ normalizedAddress: addr.trim(), lat: nLat, lng: nLng }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        margin: '12px 0',
        padding: 16,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        display: 'grid',
        gap: 10,
        gridTemplateColumns: 'minmax(280px, 2fr) 110px 110px auto auto',
        alignItems: 'end',
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Normalized address {isExisting && '(editing)'}</span>
        <input value={addr} onChange={(e) => setAddr(e.target.value)} readOnly={isExisting} maxLength={300} required />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Lat</span>
        <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" required />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Lng</span>
        <input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" required />
      </label>
      <button type="submit" className="btn-primary" disabled={submitting} style={{ marginTop: 0 }}>
        {submitting ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="admin-tab" onClick={onCancel}>Cancel</button>
      {error && <p className="rating-error" style={{ gridColumn: '1 / -1', margin: 0 }}>{error}</p>}
    </form>
  );
}
