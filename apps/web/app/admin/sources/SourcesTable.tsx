'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '../../Logo';
import { AreaRequestsBadge } from '../_components/AreaRequestsBadge';

interface SourceRow {
  id: string;
  name: string;
  adapterKey: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: 'ok' | 'error' | null | string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  totalEvents: number;
  upcomingEvents: number;
  added24h: number;
  added7d: number;
}

const STALE_HOURS = 30; // a daily-cron source older than 30h is suspicious

function relTime(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function healthStatus(s: SourceRow): { label: string; color: string; tone: 'ok' | 'warn' | 'error' | 'idle' } {
  if (!s.enabled) return { label: 'disabled', color: 'var(--fg-subtle)', tone: 'idle' };
  if (s.lastStatus === 'error') return { label: 'error', color: '#c44', tone: 'error' };
  if (!s.lastRunAt) return { label: 'never run', color: 'var(--fg-muted)', tone: 'warn' };
  const hoursSince = (Date.now() - new Date(s.lastRunAt).getTime()) / (1000 * 60 * 60);
  if (hoursSince > STALE_HOURS) return { label: 'stale', color: '#b45309', tone: 'warn' };
  return { label: 'ok', color: '#1f7a3f', tone: 'ok' };
}

export default function SourcesTable() {
  const router = useRouter();
  const [items, setItems] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/sources')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { sources: SourceRow[] }) => setItems(d.sources))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.replace('/admin/login');
  };

  const act = async (s: SourceRow, action: 'trigger' | 'enable' | 'disable') => {
    if (action === 'trigger' && !window.confirm(`Re-ingest "${s.name}" now? This runs synchronously and can take up to 60s.`)) {
      return;
    }
    setBusyId(s.id);
    setTriggerResult(null);
    try {
      const res = await fetch(`/api/admin/sources/${s.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; ms?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (action === 'trigger') {
        setTriggerResult(`Re-ingested "${s.name}" in ${data.ms}ms — reloading…`);
      }
      load();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  const enabled = items.filter((s) => s.enabled);
  const errorCount = enabled.filter((s) => s.lastStatus === 'error').length;
  const staleCount = enabled.filter((s) => s.lastRunAt && (Date.now() - new Date(s.lastRunAt).getTime()) / 3.6e6 > STALE_HOURS).length;

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
          <Link href="/admin/area-requests" className="admin-tab">Areas<AreaRequestsBadge /></Link>
          <Link href="/admin/sources" className="admin-tab admin-tab-active">Sources</Link>
          <Link href="/admin/api-keys" className="admin-tab">Keys</Link>
          <button type="button" className="admin-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-label">Sources</span>
          <span className="admin-stat-value">{items.length}</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Enabled</span>
          <span className="admin-stat-value">{enabled.length}</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Errored</span>
          <span className="admin-stat-value" style={{ color: errorCount > 0 ? '#c44' : undefined }}>{errorCount}</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Stale (&gt;{STALE_HOURS}h)</span>
          <span className="admin-stat-value" style={{ color: staleCount > 0 ? '#b45309' : undefined }}>{staleCount}</span>
        </div>
      </div>

      {triggerResult && (
        <div style={{ padding: 10, background: 'rgba(31, 122, 63, 0.1)', border: '1px solid #1f7a3f', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          {triggerResult}
        </div>
      )}
      {error && <div className="error">Failed to load: {error}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Status</th>
            <th>Last run</th>
            <th className="admin-th-right">Upcoming</th>
            <th className="admin-th-right">Added 24h / 7d</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading && items.length === 0 && (
            <tr><td colSpan={6} className="admin-empty-row">Loading…</td></tr>
          )}
          {!loading && items.length === 0 && (
            <tr><td colSpan={6} className="admin-empty-row">No sources configured.</td></tr>
          )}
          {items.map((s) => {
            const health = healthStatus(s);
            return (
              <tr key={s.id} style={{ opacity: s.enabled ? 1 : 0.6 }}>
                <td>
                  <div style={{ fontWeight: 500 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-subtle)', fontFamily: 'monospace' }}>{s.adapterKey}</div>
                </td>
                <td>
                  <span
                    className="badge"
                    style={{
                      background: health.color,
                      color: '#fff',
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontWeight: 600,
                    }}
                  >
                    {health.label}
                  </span>
                  {s.lastError && (
                    <details style={{ marginTop: 4, fontSize: 11 }}>
                      <summary style={{ cursor: 'pointer', color: '#c44' }}>error</summary>
                      <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', color: 'var(--fg-muted)', fontSize: 11 }}>{s.lastError}</pre>
                    </details>
                  )}
                </td>
                <td className="admin-td-nowrap" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                  {relTime(s.lastRunAt)}
                </td>
                <td className="admin-td-right">{s.upcomingEvents}</td>
                <td className="admin-td-right" style={{ fontSize: 12 }}>
                  <span style={{ color: s.added24h > 0 ? 'var(--fg)' : 'var(--fg-muted)' }}>{s.added24h}</span>
                  <span style={{ color: 'var(--fg-subtle)' }}> / </span>
                  <span>{s.added7d}</span>
                </td>
                <td className="admin-td-right">
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <button
                      type="button"
                      className="admin-tab"
                      onClick={() => act(s, 'trigger')}
                      disabled={busyId === s.id || !s.enabled}
                      style={{ fontSize: 12 }}
                      title="Re-ingest this source now"
                    >
                      {busyId === s.id ? '…' : 'Run now'}
                    </button>
                    <button
                      type="button"
                      className="admin-tab"
                      onClick={() => act(s, s.enabled ? 'disable' : 'enable')}
                      disabled={busyId === s.id}
                      style={{ fontSize: 12 }}
                    >
                      {s.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
