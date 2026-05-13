// Admin layout — applies on all /admin routes. Uses the same globals
// as the rest of the site (the wordmark dot color, etc.) but the UI
// is intentionally plain — this is a back-office tool.

import type { ReactNode } from 'react';

export const metadata = {
  title: 'Proactivity · Admin',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="admin-shell">{children}</div>;
}
