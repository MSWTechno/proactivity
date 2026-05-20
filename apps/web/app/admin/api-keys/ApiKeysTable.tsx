'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '../../Logo';

interface KeyRow {
  id: string;
  prefix: string;
  label: string;
  ownerEmail: string | null;
  dailyQuota: number | null;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function ApiKeysTable() {
  const router = useRouter();
  const [items, setItems] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  // After mint, hold the plaintext key here so the user can copy it. Cleared
  // when the form is closed or another key is minted.
  const [justMinted, setJustMinted] = useState<{ label: string; plaintext: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/api-keys')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { keys: KeyRow[] }) => setItems(d.keys))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.replace('/admin/login');
  };

  const setActive = async (id: string, action: 'revoke' | 'restore') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/api-keys/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
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

  const deleteKey = async (row: KeyRow) => {
    if (!window.confirm(`Hard-delete the key "${row.label}" (${row.prefix}…)? Revoke is usually safer — it keeps the audit trail.`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/api-keys/${row.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setItems((xs) => xs.filter((x) => x.id !== row.id));
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
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
          <Link href="/admin/organizations" className="admin-tab">Orgs</Link>
          <Link href="/admin/area-requests" className="admin-tab">Areas</Link>
          <Link href="/admin/api-keys" className="admin-tab admin-tab-active">Keys</Link>
          <button type="button" className="admin-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-label">Active keys</span>
          <span className="admin-stat-value">{items.filter((k) => k.active).length}</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label">Revoked</span>
          <span className="admin-stat-value">{items.filter((k) => !k.active).length}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => { setShowForm((v) => !v); setJustMinted(null); }}
            style={{ marginTop: 0, padding: '10px 18px' }}
          >
            {showForm ? 'Cancel' : '+ Mint key'}
          </button>
        </div>
      </div>

      {justMinted && <JustMintedBanner label={justMinted.label} plaintext={justMinted.plaintext} onClose={() => setJustMinted(null)} />}

      {showForm && (
        <MintForm
          onDone={(result) => {
            setShowForm(false);
            setJustMinted(result);
            load();
          }}
        />
      )}

      {error && <div className="error">Failed to load: {error}</div>}

      <table className="admin-table" style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>Label</th>
            <th>Prefix</th>
            <th>Owner</th>
            <th>Quota</th>
            <th>Last used</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading && items.length === 0 && (
            <tr><td colSpan={7} className="admin-empty-row">Loading…</td></tr>
          )}
          {!loading && items.length === 0 && (
            <tr><td colSpan={7} className="admin-empty-row">No API keys yet. Mint one above.</td></tr>
          )}
          {items.map((k) => (
            <tr key={k.id} style={{ opacity: k.active ? 1 : 0.5 }}>
              <td><strong>{k.label}</strong></td>
              <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{k.prefix}…</td>
              <td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{k.ownerEmail ?? '—'}</td>
              <td style={{ fontSize: 12 }}>{k.dailyQuota ?? 'unlimited'}</td>
              <td style={{ fontSize: 12, color: 'var(--fg-muted)' }} className="admin-td-nowrap">
                {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}
              </td>
              <td>
                <span className={`badge organizer-status-badge organizer-status-${k.active ? 'approved' : 'rejected'}`}>
                  {k.active ? 'active' : 'revoked'}
                </span>
              </td>
              <td className="admin-td-right">
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  {k.active ? (
                    <button
                      type="button"
                      className="admin-tab admin-btn-reject"
                      onClick={() => setActive(k.id, 'revoke')}
                      disabled={busyId === k.id}
                      style={{ fontSize: 12 }}
                    >
                      Revoke
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="admin-tab"
                      onClick={() => setActive(k.id, 'restore')}
                      disabled={busyId === k.id}
                      style={{ fontSize: 12 }}
                    >
                      Restore
                    </button>
                  )}
                  <button
                    type="button"
                    className="admin-tab admin-btn-reject"
                    onClick={() => deleteKey(k)}
                    disabled={busyId === k.id}
                    style={{ fontSize: 12 }}
                    title="Hard-delete (loses audit trail; revoke is usually better)"
                  >
                    Delete
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

function MintForm({ onDone }: { onDone: (r: { label: string; plaintext: string }) => void }) {
  const [label, setLabel] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [dailyQuota, setDailyQuota] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!label.trim()) { setError('Label is required.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          ownerEmail: ownerEmail.trim() || undefined,
          dailyQuota: dailyQuota.trim() ? Number(dailyQuota) : null,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; label?: string; plaintext?: string; error?: string };
      if (!res.ok || !data.plaintext) throw new Error(data.error ?? `HTTP ${res.status}`);
      onDone({ label: data.label ?? label.trim(), plaintext: data.plaintext });
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
        marginTop: 16,
        padding: 16,
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--bg-elev)',
        display: 'grid',
        gap: 10,
        gridTemplateColumns: 'minmax(200px, 1fr) minmax(200px, 1fr) 140px auto',
        alignItems: 'end',
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Label *</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Lake Anna site" required maxLength={100} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Owner email (optional)</span>
        <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="contact@partner.com" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Daily quota</span>
        <input
          type="number"
          value={dailyQuota}
          onChange={(e) => setDailyQuota(e.target.value)}
          placeholder="unlimited"
          min={1}
          max={1000000}
        />
      </label>
      <button type="submit" className="btn-primary" disabled={submitting} style={{ marginTop: 0 }}>
        {submitting ? 'Minting…' : 'Mint'}
      </button>
      {error && <p className="rating-error" style={{ gridColumn: '1 / -1' }}>{error}</p>}
    </form>
  );
}

function JustMintedBanner({ label, plaintext, onClose }: { label: string; plaintext: string; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: 'key' | 'embed', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard denied */ }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://proactivity.app';
  const embedSnippet = `<div data-proactivity-embed
     data-key="${plaintext}"
     data-location="lake-anna"
     data-radius-mi="25"
     data-days="7"></div>
<script src="${origin}/embed.js" async></script>`;

  return (
    <div
      style={{
        marginTop: 16,
        padding: 16,
        border: '2px solid var(--warning-fg, #b45309)',
        borderRadius: 8,
        background: 'var(--warning-bg, rgba(245, 158, 11, 0.1))',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>New key for "{label}" — copy now, you won't see it again</strong>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--fg-muted)' }}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      <div
        style={{
          marginTop: 10,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          background: 'var(--bg-subtle, #f4f4f8)',
          padding: '10px 12px',
          borderRadius: 6,
        }}
      >
        <code style={{ flex: 1, fontFamily: 'monospace', fontSize: 14, wordBreak: 'break-all' }}>{plaintext}</code>
        <button
          type="button"
          className="admin-tab"
          onClick={() => copy('key', plaintext)}
          style={{ fontSize: 12, flexShrink: 0 }}
        >
          {copied === 'key' ? 'Copied!' : 'Copy key'}
        </button>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--fg-muted)' }}>
          Embed snippet (drop into any partner site)
        </summary>
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            background: 'var(--bg-subtle, #f4f4f8)',
            padding: '10px 12px',
            borderRadius: 6,
          }}
        >
          <pre style={{
            flex: 1, fontFamily: 'monospace', fontSize: 12, margin: 0,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>{embedSnippet}</pre>
          <button
            type="button"
            className="admin-tab"
            onClick={() => copy('embed', embedSnippet)}
            style={{ fontSize: 12, flexShrink: 0 }}
          >
            {copied === 'embed' ? 'Copied!' : 'Copy HTML'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--fg-muted)', margin: '6px 2px 0' }}>
          Adjust <code>data-location</code> (harrisonburg | lake-anna), or replace with
          <code>data-lat</code> + <code>data-lng</code>. Optional: <code>data-theme</code>
          (light | dark | auto), <code>data-limit</code>, <code>data-categories</code>.
        </p>
      </details>

      <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 10, marginBottom: 0 }}>
        Only the SHA-256 hash is stored. There's no way to retrieve this plaintext later — if you lose it, revoke this key and mint a new one.
      </p>
    </div>
  );
}
