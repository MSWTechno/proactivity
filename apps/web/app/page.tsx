import type { Metadata } from 'next';
import HomeClient from './HomeClient';

// Server wrapper so the (client) homepage can declare a self-referencing
// canonical. Resolved against metadataBase (apex), so even the www host emits
// `<link rel="canonical" href="https://proactivity.app/">` — this collapses
// www/apex and ?param variants onto one canonical for Search Console.
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default function Page() {
  return <HomeClient />;
}
