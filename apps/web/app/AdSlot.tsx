'use client';

import { useEffect, useRef } from 'react';

/**
 * AdSense slot. Renders nothing when:
 *  - NEXT_PUBLIC_ADSENSE_CLIENT_ID is unset (no AdSense configured)
 *  - the slot prop is empty (specific ad unit ID not configured yet)
 *  - hidden=true (passed by callers when the user has the noAds subscription)
 *
 * The AdSense script is injected at the layout level. Each <ins> element is
 * registered exactly once via the pushed ref — re-pushing the same element
 * raises an error in adsbygoogle.
 */

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

interface AdSlotProps {
  slot: string | undefined;
  hidden?: boolean;
  format?: 'auto' | 'fluid' | 'rectangle' | 'horizontal' | 'vertical';
  layoutKey?: string;
  style?: React.CSSProperties;
}

export function AdSlot({ slot, hidden, format = 'auto', layoutKey, style }: AdSlotProps) {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const pushed = useRef(false);

  useEffect(() => {
    if (hidden || !client || !slot || pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch {
      // adsbygoogle.push() can throw on duplicate-init in React StrictMode.
      // Safe to swallow — AdSense recovers on next route change.
    }
  }, [hidden, client, slot]);

  if (hidden || !client || !slot) return null;

  return (
    <ins
      className="adsbygoogle adslot"
      style={{ display: 'block', ...style }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format={format}
      data-ad-layout-key={layoutKey}
      data-full-width-responsive="true"
    />
  );
}
