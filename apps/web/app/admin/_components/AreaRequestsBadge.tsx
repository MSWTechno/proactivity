'use client';

import { useEffect, useState } from 'react';

/**
 * Tiny badge that fetches the count of `status='requested'` rows in
 * /api/admin/area-requests and renders a small chip when > 0. Used in
 * the "Areas" admin nav tab so admins notice new region requests
 * without polling /admin/area-requests directly.
 *
 * Failures are silent — a network blip just shows no badge.
 */
export function AreaRequestsBadge() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/area-requests')
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d: { requests?: Array<{ status: string }> }) => {
        if (cancelled) return;
        const n = (d.requests ?? []).filter((r) => r.status === 'requested').length;
        setCount(n);
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} pending area request${count === 1 ? '' : 's'}`}
      style={{
        marginLeft: 6,
        background: 'var(--warning-fg, #d97706)',
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        padding: '1px 6px',
        borderRadius: 10,
        minWidth: 16,
        display: 'inline-block',
        textAlign: 'center',
        lineHeight: 1.4,
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
