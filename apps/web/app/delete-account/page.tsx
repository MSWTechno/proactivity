import Link from 'next/link';
import type { Metadata } from 'next';
import { Logo } from '../Logo';

export const metadata: Metadata = {
  title: 'Delete your account · Proactivity',
  description:
    'How to request deletion of your Proactivity account and the personal data associated with it.',
};

export default function DeleteAccountPage() {
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

      <h1>Delete your account</h1>
      <p>
        You can ask us to delete your Proactivity account and the personal data
        tied to it at any time. This page explains how to make the request and
        what happens to your data.
      </p>

      <h2>How to request deletion</h2>
      <p>
        Send a request through our <Link href="/contact">contact form</Link>{' '}
        <strong>from the email address associated with your account</strong>,
        and include the word &ldquo;delete&rdquo; or &ldquo;account
        deletion&rdquo; in your message. Using your account email lets us
        confirm the request is really you before we remove anything. If you
        can&rsquo;t reach us from that address, send the request anyway and
        we&rsquo;ll work with you to verify your identity another way.
      </p>
      <p>
        No sign-in is required to submit the request — the{' '}
        <Link href="/contact">contact form</Link> is open to everyone.
      </p>

      <h2>What gets deleted</h2>
      <p>
        Once verified, we delete the personal data we hold about you,
        including:
      </p>
      <ul>
        <li>Your email address and account record.</li>
        <li>Your name, if you provided one.</li>
        <li>Your saved preferences (interests, onboarding state).</li>
        <li>
          Your Stripe customer and subscription identifiers, if you ever
          subscribed to Plus. (Card details were never stored by us — Stripe
          handles those directly.)
        </li>
      </ul>
      <p>
        We complete deletion within <strong>30 days</strong> of verifying your
        request.
      </p>

      <h2>What may remain</h2>
      <p>
        A few things persist because they aren&rsquo;t tied to your identity,
        consistent with our{' '}
        <Link href="/privacy">Privacy Policy</Link>:
      </p>
      <ul>
        <li>
          <strong>Anonymous aggregates</strong> — e.g. click counters on events
          and categories. These were never linked to you.
        </li>
        <li>
          <strong>Public content you posted</strong> — approved ratings/reviews
          or events you organized may stay visible in anonymized form (no
          submitter name shown). If you want this removed entirely, say so in
          your request and we&rsquo;ll take it down.
        </li>
      </ul>
      <p>
        We may also retain limited records where we&rsquo;re legally required
        to (for example, to comply with tax or anti-abuse obligations).
      </p>

      <h2>Questions</h2>
      <p>
        For anything else about your data, see our{' '}
        <Link href="/privacy">Privacy Policy</Link> or{' '}
        <Link href="/contact">get in touch</Link>.
      </p>

      <p className="disclaimer" style={{ marginTop: 32 }}>
        Powered by{' '}
        <a href="https://msw-technologies.com" target="_blank" rel="noopener noreferrer">
          MSW Technologies
        </a>
      </p>
    </main>
  );
}
