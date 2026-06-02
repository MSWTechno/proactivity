import Link from 'next/link';
import type { Metadata } from 'next';
import { Logo } from '../Logo';

export const metadata: Metadata = {
  title: 'Privacy Policy · Proactivity',
  description: 'How Proactivity handles your data.',
};

const EFFECTIVE_DATE = 'May 18, 2026';

export default function PrivacyPage() {
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

      <h1>Privacy Policy</h1>
      <p className="legal-meta">Effective {EFFECTIVE_DATE}</p>

      <section className="legal-tldr">
        <h2>Short version</h2>
        <ul>
          <li>We collect as little as possible. Your email if you sign in. Your location, in real time, if you let us — we don't keep it.</li>
          <li>We don't sell your data and we don't use third-party analytics or tracking pixels.</li>
          <li>We show ads from Google AdSense on the website and Google AdMob in the mobile app. Both use Google's privacy controls; the EU/UK/Switzerland consent banner is shown where required. The mobile app requests <em>non-personalized</em> ads by default, so no advertising-ID tracking happens unless we add explicit opt-in.</li>
          <li>Some pages link to lodging partners (Vrbo, Expedia) as <strong>affiliate links</strong>. When you click one, the partner may set a tracking cookie so we get a small commission if you book. The price you pay is the same.</li>
          <li>You can ask us to delete your account or your data any time via our <Link href="/contact">contact form</Link>.</li>
        </ul>
      </section>

      <h2>1. Who we are</h2>
      <p>
        Proactivity is an events aggregator that helps people find things to do nearby in the next week or two. "Proactivity," "we," and "us" refer to the operator of the proactivity.app website and the Proactivity mobile app. If you have a question about this policy, send us a message via our <Link href="/contact">contact form</Link>.
      </p>

      <h2>2. What we collect, and why</h2>
      <h3>Information you give us</h3>
      <ul>
        <li><strong>Email address.</strong> Required to sign in (we use a one-time magic link, no password). Optional if you submit a rating or use the "submit your event" contact form. Stored so we can identify you on future sign-ins and so you can manage your account.</li>
        <li><strong>Name.</strong> Optional. If you provide one with a rating it's displayed publicly alongside your review.</li>
        <li><strong>Ratings and reviews.</strong> Star ratings (1-5) and optional review text you submit about events or organizers. Public once an administrator approves them.</li>
        <li><strong>Organizer submissions.</strong> If you act as an event organizer, the organization name, URL, event details, and any URLs you submit for us to scrape. Reviewed by an administrator before becoming public.</li>
        <li><strong>Payment info.</strong> If you subscribe to Plus, card details are entered directly into Stripe — we never see or store them. We keep your Stripe customer and subscription IDs.</li>
      </ul>

      <h3>Information we collect automatically</h3>
      <ul>
        <li><strong>Location (only with your permission).</strong> The browser or mobile OS asks before we get your coordinates. We use them in real time to query nearby events. We do <em>not</em> store your location alongside your account, and we do not track your location over time.</li>
        <li><strong>Anonymous click counters.</strong> When you tap an event card or a category chip, we increment a counter on that event/category. The counter is not linked to your identity — we use it to order popular categories and surface frequently-viewed events.</li>
        <li><strong>Approximate IP address.</strong> Logged by our hosting provider for security and abuse prevention. For submissions (ratings, contact form) we keep the originating IP to help moderation if needed.</li>
        <li><strong>Cookies and local storage.</strong> See "Cookies and similar technologies" below.</li>
      </ul>

      <h3>What we don't collect</h3>
      <ul>
        <li>No advertising IDs from your mobile device. AdMob serves non-personalized ads by default, so the IDFA prompt on iOS is not shown.</li>
        <li>No social-media tracking pixels.</li>
        <li>No fingerprinting or cross-site tracking on our own behalf.</li>
        <li>Aside from Google Analytics (described below) we don't run other third-party analytics — no Mixpanel, no Segment, no Heap, etc.</li>
      </ul>

      <h2>3. How we use what we collect</h2>
      <ul>
        <li>To authenticate you and keep you signed in.</li>
        <li>To return events relevant to where you are.</li>
        <li>To moderate user-submitted content (ratings, organizer claims, event drafts, URL submissions).</li>
        <li>To send you transactional emails: the magic-link sign-in email and notifications about submissions you made.</li>
        <li>To run the Plus subscription (Stripe webhooks update your status).</li>
        <li>To prevent abuse and respond to reports.</li>
      </ul>
      <p>
        We do <strong>not</strong> use your data for behavioral advertising on our own behalf and we do not sell your personal information.
      </p>

      <h2>4. Who we share data with</h2>
      <p>The following service providers process data on our behalf. Each has its own privacy commitments.</p>
      <ul>
        <li><strong>Vercel</strong> (hosting). Processes HTTP requests to the website. <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noreferrer">Privacy policy</a>.</li>
        <li><strong>Neon</strong> (database). Stores the records described above. <a href="https://neon.com/privacy-policy" target="_blank" rel="noreferrer">Privacy policy</a>.</li>
        <li><strong>Resend</strong> (email delivery). Sends sign-in and notification emails. <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noreferrer">Privacy policy</a>.</li>
        <li><strong>Stripe</strong> (payments). Handles all card data for Plus subscriptions. <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer">Privacy policy</a>.</li>
        <li><strong>Google Analytics</strong> (website). Aggregates anonymized traffic data (page views, referrers, approximate country/region) so we can understand which features are useful. Sets the <code>_ga</code> family of cookies. We do not configure Google Analytics to receive your email, name, or other identifying information. <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy policy</a>.</li>
        <li><strong>Google AdSense</strong> (advertising, website). Loads ads on the website and may set cookies for ad personalization. Subject to Google's consent banner in the EU/UK/Switzerland. <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy policy</a>.</li>
        <li><strong>Google AdMob</strong> (advertising, mobile app). The mobile-app counterpart to AdSense. We request <strong>non-personalized ads only</strong> by default, which means we don't ask the OS for your advertising identifier (IDFA on iOS) and AdMob shows contextual ads rather than ads targeted to your activity. <a href="https://support.google.com/admob/answer/6128543" target="_blank" rel="noreferrer">AdMob's data disclosure</a>.</li>
        <li><strong>CJ Affiliate (Commission Junction)</strong> (affiliate links). On some pages we link to lodging partners (Vrbo, Expedia). When you click one of these links, CJ may set a tracking cookie so that a partner can attribute a resulting booking to us and pay us a small commission. You pay nothing extra. <a href="https://www.cj.com/legal/privacy-policy-publishers-and-advertisers-prior-3-15-2024" target="_blank" rel="noreferrer">CJ's privacy policy</a>.</li>
        <li><strong>Google OAuth</strong> (admin sign-in only). Used only by Proactivity administrators to sign in to the moderation tools — not by regular users.</li>
      </ul>
      <p>We may also share data when legally required (subpoenas, court orders) or to protect our rights and the safety of our users.</p>

      <h2>5. Cookies and similar technologies</h2>
      <p>On the website:</p>
      <ul>
        <li><code>proactivity_user</code> — your sign-in session cookie, signed with HMAC. Lasts 30 days. Required for sign-in to work.</li>
        <li><code>proactivity_admin</code> — same purpose but for administrators only.</li>
        <li><strong>Local storage</strong> — stores your onboarding choice, preferred event categories, and (on mobile) your session token. This data never leaves your device unless you sync it via a backup.</li>
        <li><strong>AdSense cookies</strong> — set by Google for ad delivery and (with your consent) ad personalization. Managed by Google's consent banner where required.</li>
        <li><strong>Google Analytics cookies</strong> (<code>_ga</code>, <code>_ga_*</code>) — used to distinguish unique sessions and aggregate traffic. Subject to the same consent flow Google applies in the EU/UK/Switzerland.</li>
      </ul>
      <p>The mobile app does not use the AdSense web SDK. It does load Google AdMob (described above) to serve banner ads, which may set or read local advertising data. It stores the same kind of preference data as the website (session, interests, onboarding state) in the OS's app storage.</p>

      <h2>6. Your rights</h2>
      <p>Wherever you live, you can <Link href="/contact">contact us</Link> to:</p>
      <ul>
        <li>See what data we have about you.</li>
        <li>Correct it.</li>
        <li><Link href="/delete-account">Delete your account</Link> and all data tied to it. We'll honor this within 30 days.</li>
        <li>Receive a copy of your data in a portable format.</li>
        <li>Object to specific uses or restrict processing.</li>
      </ul>
      <h3>If you live in the EEA, UK, or Switzerland</h3>
      <p>
        Under the GDPR, you have additional rights including the right to lodge a complaint with your local data protection authority. Our legal bases for processing are: <strong>contract</strong> (running the service you signed up for), <strong>consent</strong> (location, ad personalization), and <strong>legitimate interest</strong> (preventing abuse, moderating submissions).
      </p>
      <h3>If you live in California</h3>
      <p>
        Under the CCPA, you have the right to know what we collect, to delete it, and to opt out of "sale" of your personal information. We don't sell personal information.
      </p>

      <h2>7. Children's privacy</h2>
      <p>
        Proactivity is not directed at children under 13. We don't knowingly collect data from anyone under 13. If you believe we've inadvertently collected data from a child, contact us and we'll delete it.
      </p>

      <h2>8. Data retention</h2>
      <p>
        We keep account data as long as your account is active. If you delete your account, we delete the personal data tied to you within 30 days. Anonymized aggregates (e.g. click counters on events) may persist because they aren't linked to anyone.
      </p>
      <p>
        Public content you posted (approved ratings/reviews, events you organized) may remain visible after account deletion in anonymous form (no submitter name shown). On request we'll remove it entirely.
      </p>

      <h2>9. Security</h2>
      <p>
        We use HTTPS everywhere, hash and sign session tokens with HMAC, and rely on the security posture of the providers listed above. No system is perfectly secure, and no method of transmission over the internet is 100% safe — but we try to apply reasonable practices.
      </p>

      <h2>10. International transfers</h2>
      <p>
        Our hosting, database, and email providers may process data in the United States or other countries. If you're outside the US, your data is transferred to and processed in countries that may not have the same data protection laws as your country.
      </p>

      <h2>11. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. We'll change the "Effective" date at the top. For material changes, we'll try to notify you (e.g., via email or a banner). Continued use after a change means you accept the updated policy.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions, requests, or complaints? <Link href="/contact">Send us a message</Link>.
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
