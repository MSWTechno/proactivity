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
