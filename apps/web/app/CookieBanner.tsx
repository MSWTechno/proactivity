'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'proactivity:cookies-ack:v1';

export function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== '1') setShow(true);
    } catch {
      // localStorage unavailable (private mode etc.) — just don't show
    }
  }, []);

  const ack = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
    setShow(false);
  };

  if (!show) return null;
  return (
    <div className="cookie-banner" role="dialog" aria-label="Cookie notice">
      <p>
        Proactivity uses cookies for personalized ads and analytics. By continuing to use the site you agree to this.
      </p>
      <button type="button" onClick={ack} className="cookie-banner-ack">OK</button>
    </div>
  );
}
