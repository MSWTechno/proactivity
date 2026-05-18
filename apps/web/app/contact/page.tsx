import Link from 'next/link';
import type { Metadata } from 'next';
import { Logo } from '../Logo';
import { ContactForm } from './ContactForm';

export const metadata: Metadata = {
  title: 'Contact · Proactivity',
  description: 'Get in touch with Proactivity — questions, partnership ideas, privacy requests, or event submissions.',
};

export default function ContactPage() {
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

      <h1>Contact us</h1>
      <p>
        Questions, feedback, partnership ideas, privacy requests, or anything else — drop us a line below and we'll get back to you. For event submissions, you can also use the "Submit event" button on the <Link href="/">home page</Link>.
      </p>

      <ContactForm />

      <p className="disclaimer" style={{ marginTop: 32 }}>
        Powered by{' '}
        <a href="https://msw-technologies.com" target="_blank" rel="noopener noreferrer">
          MSW Technologies
        </a>
      </p>
    </main>
  );
}
