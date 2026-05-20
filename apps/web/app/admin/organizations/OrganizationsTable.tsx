'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '../../Logo';
import { AreaRequestsBadge } from '../_components/AreaRequestsBadge';

interface Org {
  id: string;
  organizerKey: string;
  organizerName: string | null;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  moderatorNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  userEmail: string | null;
  userName: string | null;
  eventCount: number;
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

export default function OrganizationsTable() {
  const router = useRouter();
  const [items, setItems] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedSearch) p.set('search', debouncedSearch);
    if (statusFilter !== 'all') p.set('status', statusFilter);
    return p.toString();
  }, [debouncedSearch, statusFilter]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/organizations?${queryString}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ organizations: Org[] }>;
      })
      .then((d) => setItems(d.organizations))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [queryString]);

  useEffect(() => { load(); }, [load]);

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.replace('/admin/login');
  };

  const deleteOrg = async (o: Org) => {
    const isUserCreated = o.organizerKey.startsWith('user:');
    const warn = isUserCreated && o.eventCount > 0
      ? `Delete claim for "${o.organizerName ?? o.organizerKey}"? This will also delete ${o.eventCount} event${o.eventCount === 1 ? '' : 's'} (user-created org, no other approved claims left). Can't be undone.`
      : `Delete claim for "${o.organizerName ?? o.organizerKey}"? Can't be undone.`;
    if (!window.confirm(warn)) return;
    setBusyId(o.id);
    try {
      const res = await fetch(`/api/admin/claims/${o.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setItems((xs) => xs.filter((x) => x.id !== o.id));
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  const moderate = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/claims/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
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
          <Link href="/admin/events" className="admin-tab">Events</Link>
          <Link href="/admin/organizations" className="admin-tab admin-tab-active">Orgs</Link>
          <Link href="/admin/area-requests" className="admin-tab">Areas<AreaRequestsBadge /></Link>
          <Link href="/admin/sources" className="admin-tab">Sources</Link>
          <Link href="/admin/api-keys" className="admin-tab">Keys</Link>
          <button type="button" className="admin-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-label">Showing</span>
          <span className="admin-stat-value">{items.length}</span>
        </div>
      </div>

      <div className="admin-filters">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search org name, key, or user email…"
          className="rating-input"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rating-input"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {error && <div className="error">Failed to load: {error}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Organization</th>
            <th>Claimant</th>
            <th>Status</th>
            <th className="admin-th-right">Events</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading && items.length === 0 && (
            <tr><td colSpan={6} className="admin-empty-row">Loading…</td></tr>
          )}
          {!loading && items.length === 0 && (
            <tr><td colSpan={6} className="admin-empty-row">No matching organizations.</td></tr>
          )}
          {items.map((o) => (
            <tr key={o.id}>
              <td>
                <div style={{ fontWeight: 500 }}>{o.organizerName ?? '(no name)'}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-subtle)', fontFamily: 'monospace' }}>{o.organizerKey}</div>
                {o.organizerKey.startsWith('user:') && (
                  <span className="admin-tag" style={{ marginTop: 4, display: 'inline-block' }}>user-created</span>
                )}
              </td>
              <td>
                <div>{o.userName ?? '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                  {o.userEmail ? <a href={`mailto:${o.userEmail}`}>{o.userEmail}</a> : '—'}
                </div>
              </td>
              <td>
                <span className={`badge organizer-status-badge organizer-status-${o.status}`}>
                  {o.status}
                </span>
              </td>
              <td className="admin-td-right">{o.eventCount}</td>
              <td className="admin-td-nowrap" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                {new Date(o.createdAt).toLocaleDateString()}
              </td>
              <td className="admin-td-right">
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  {o.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        className="admin-tab"
                        onClick={() => moderate(o.id, 'approve')}
                        disabled={busyId === o.id}
                        style={{ fontSize: 12 }}
                      >Approve</button>
                      <button
                        type="button"
                        className="admin-tab"
                        onClick={() => moderate(o.id, 'reject')}
                        disabled={busyId === o.id}
                        style={{ fontSize: 12 }}
                      >Reject</button>
                    </>
                  )}
                  <button
                    type="button"
                    className="admin-tab admin-btn-reject"
                    onClick={() => deleteOrg(o)}
                    disabled={busyId === o.id}
                    style={{ fontSize: 12 }}
                  >
                    {busyId === o.id ? '…' : 'Delete'}
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
