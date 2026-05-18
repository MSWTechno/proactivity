import Link from 'next/link';
import type { Metadata } from 'next';
import { Logo } from '../Logo';

export const metadata: Metadata = {
  title: 'About · Proactivity',
  description: 'How Proactivity works — for people looking for things to do, and for organizers who want their events listed.',
};

export default function AboutPage() {
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

      <h1>About Proactivity</h1>
      <p className="legal-meta">Things to do near you, this week.</p>

      <section className="legal-tldr">
        <h2>What this is</h2>
        <ul>
          <li>A no-fuss list of things actually happening near you in the next day or two — sortable by time, distance, or price.</li>
          <li>Free for attendees. Free for organizers. Ads keep the lights on; a Plus subscription removes them.</li>
          <li>Built for last-minute plans, not far-off bookings: most events shown start within the next week.</li>
        </ul>
      </section>

      <h2>For people looking for things to do</h2>
      <p>
        Open the site (or <Link href="/">the home page</Link>) and we'll ask for your location — purely so we can sort events by how close they are. We don't store it. From there:
      </p>
      <ul>
        <li><strong>Filter</strong> by category, date range (today / this week / this month), distance, free-only, or text search.</li>
        <li><strong>Sort</strong> by soonest, nearest, or cheapest.</li>
        <li><strong>Tap a card</strong> to open the organizer's own page where you can register, buy a ticket, or just show up.</li>
        <li><strong>Rate events and organizers</strong> after attending — your reviews help everyone else pick.</li>
        <li><strong>Sign in</strong> (one-time magic link, no password) to save preferences and rate things.</li>
      </ul>
      <p>
        There's also a <strong>mobile app</strong> (iOS and Android, coming via the app stores) that does the same thing with native location and push hooks. The website works fine on a phone in the meantime.
      </p>

      <h2>For organizers and businesses</h2>
      <p>
        If you run events — a brewery with a trivia night, a yoga studio with weekly classes, a venue hosting bands, a museum, a nonprofit, a meetup — there are two ways to get listed.
      </p>

      <h3>1. Submit a single event</h3>
      <p>
        Quickest path. From any page, click <strong>"Submit event"</strong> and paste a URL or describe what's happening. We review submissions for accuracy and publish them, usually within a day. No account required.
      </p>

      <h3>2. Claim your organization for ongoing listings</h3>
      <p>
        If you'll be posting more than once, <Link href="/organizer">create an organizer account</Link> (still free, still magic-link sign-in). With an organizer account you can:
      </p>
      <ul>
        <li>Submit URLs of pages we should regularly scrape (your events calendar, an Eventbrite organizer page, a Facebook page, etc.) so new events flow in automatically.</li>
        <li>Manually add or edit individual events with full details — dates, times, age range, cost, image.</li>
        <li>Save drafts and submit them for review when ready.</li>
        <li>Get email notifications when an admin approves (or has questions about) your submissions.</li>
        <li>Earn a public organizer rating from attendees, which shows on every one of your events.</li>
      </ul>
      <p>
        Everything is reviewed by a human before going live — both to catch errors and to keep the listings high-signal for attendees.
      </p>

      <h3>What we look for</h3>
      <ul>
        <li>Public events with a clear date, time, and location (physical or virtual).</li>
        <li>Accurate cost (free is fine — most listings are).</li>
        <li>A page someone can actually click through to learn more or sign up.</li>
        <li>Events most people could attend without weeks of planning — last-minute and walk-up friendly is exactly the point.</li>
      </ul>

      <h3>What it costs</h3>
      <p>
        <strong>Nothing.</strong> Listing your events is free, today and for the foreseeable future. We monetize by showing modest, privacy-respecting ads to attendees and offering an ad-free <Link href="/pricing">Plus tier</Link> for users who'd rather pay than see ads. A paid B2B API for partners is on the roadmap, but that's separate from the organizer experience.
      </p>

      <h2>Coverage area</h2>
      <p>
        We're starting in <strong>Harrisonburg and Rockingham County, Virginia</strong>, and expanding outward from there. If your area isn't well-covered yet, submitting events is the fastest way to change that — once a region has a critical mass of listings we promote it.
      </p>

      <h2>Why we built it</h2>
      <p>
        Existing event aggregators are built for buying tickets to big-ticket shows months out. Most of life isn't that. Most of life is "what's happening tonight that I can actually go to?" Proactivity is the answer we wanted for ourselves — surfaced quickly, sortable by proximity, with no ten-step checkout.
      </p>

      <h2>Get in touch</h2>
      <p>
        Questions, partnership ideas, or just want to say what you'd like to see? <Link href="/contact">Send us a message</Link>.
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
