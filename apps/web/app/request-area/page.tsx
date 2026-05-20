import Link from 'next/link';
import { Logo } from '../Logo';
import { RequestAreaForm } from './RequestAreaForm';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Bring Proactivity to your area · Proactivity',
  description: "Don't see your city? Tell us where you are and we'll prioritize launching there next.",
};

export default function RequestAreaPage() {
  return (
    <main className="legal">
      <header style={{ marginBottom: 24 }}>
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h1 className="wordmark">
            <Logo size={26} className="wordmark-logo" />proactivity
          </h1>
        </Link>
        <Link href="/" style={{ fontSize: 13 }}>← Back to events</Link>
      </header>

      <h1>Bring Proactivity to your area</h1>
      <p>
        We launch new regions in places where someone local will help seed the
        feed. Tell us where you are and how many events you can personally add
        to bootstrap, and we'll prioritize.
      </p>

      <p
        style={{
          margin: '16px 0 24px',
          padding: '12px 14px',
          background: 'var(--warning-bg, rgba(245, 158, 11, 0.1))',
          border: '1px solid var(--warning-fg, #d97706)',
          borderRadius: 8,
          fontSize: 14,
        }}
      >
        <strong>Heads up:</strong> we're currently only launching in <strong>Virginia</strong>.
        Outside VA? Submit anyway — we use these as signal for where to expand next, and we'll
        email you when your area is on the roadmap.
      </p>

      <RequestAreaForm />

      <p className="disclaimer" style={{ marginTop: 32 }}>
        Powered by{' '}
        <a href="https://msw-technologies.com" target="_blank" rel="noopener noreferrer">
          MSW Technologies
        </a>
      </p>
    </main>
  );
}
