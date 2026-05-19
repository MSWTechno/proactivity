/**
 * Transactional email for organizer notifications. Mirrors the dev fallback
 * pattern used by the magic-link login: when RESEND_API_KEY is missing AND
 * we're not in production, just log the email to the console so local dev
 * doesn't need Resend configured.
 *
 * Callers must await send() — on Vercel serverless, un-awaited promises are
 * cut off when the function returns and the email is silently dropped.
 * Provider failures are caught here so a Resend blip never 500s the caller.
 */

import { Resend } from 'resend';
import { describeRecurrence } from './recurrence';

interface NotificationEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function send(email: NotificationEmail): Promise<void> {
  const from = process.env.NOTIFICATIONS_FROM
    ?? process.env.MAGIC_LINK_FROM
    ?? 'notifications@resend.dev';
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n[dev email to ${email.to}]\nFrom: ${from}\nSubject: ${email.subject}\n\n${email.text}\n`);
      return;
    }
    console.error(`[email] RESEND_API_KEY missing in production — skipping send to ${email.to}`);
    return;
  }

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, to: email.to, subject: email.subject, html: email.html, text: email.text });
  } catch (e) {
    console.error(`[email] send to ${email.to} failed:`, e instanceof Error ? e.message : e);
  }
}

function dashboardUrl(): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';
  return `${base}/organizer`;
}

function shell(title: string, bodyHtml: string, cta = 'View on Proactivity'): string {
  return `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #222;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">${title}</h1>
      ${bodyHtml}
      <p style="margin: 24px 0 0;">
        <a href="${dashboardUrl()}" style="display: inline-block; padding: 10px 18px; background: #6d28d9; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
          ${cta}
        </a>
      </p>
      <p style="margin: 28px 0 0; font-size: 12px; color: #888;">
        You're getting this because an item you submitted on Proactivity was reviewed.
      </p>
    </div>
  `;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// ----- public notification builders -----

export async function notifyClaimResolved(params: {
  to: string;
  organizerName: string;
  action: 'approved' | 'rejected';
  moderatorNote: string | null;
}): Promise<void> {
  const { to, organizerName, action, moderatorNote } = params;
  const subject = action === 'approved'
    ? `You're now verified as the organizer for "${organizerName}"`
    : `Your organizer claim for "${organizerName}" was rejected`;
  const note = moderatorNote ? `<p>Moderator note: ${esc(moderatorNote)}</p>` : '';
  const body = action === 'approved'
    ? `<p>Your claim to be the organizer for <strong>${esc(organizerName)}</strong> was approved. You can now submit and edit events for this organization from your dashboard.</p>${note}`
    : `<p>Your claim to be the organizer for <strong>${esc(organizerName)}</strong> was rejected.</p>${note}<p>If you think this was a mistake, reply to this email or contact us through the site.</p>`;
  const text = action === 'approved'
    ? `Your claim for "${organizerName}" was approved. You can now submit events: ${dashboardUrl()}`
    : `Your claim for "${organizerName}" was rejected.${moderatorNote ? `\n\nNote: ${moderatorNote}` : ''}\n\nDashboard: ${dashboardUrl()}`;
  await send({ to, subject, html: shell(subject, body), text });
}

export async function notifyDraftResolved(params: {
  to: string;
  title: string;
  action: 'approved' | 'rejected';
  moderatorNote: string | null;
  recurrence: { freq: string; count: number; skipCount: number } | null;
}): Promise<void> {
  const { to, title, action, moderatorNote, recurrence } = params;
  const subject = action === 'approved'
    ? `"${title}" is live on Proactivity`
    : `Your event submission for "${title}" was rejected`;
  const occurrenceCount = recurrence ? recurrence.count - recurrence.skipCount : 1;
  const recLine = recurrence
    ? `<p>This was a recurring submission — ${esc(describeRecurrence(recurrence.freq, recurrence.count, recurrence.skipCount))}. ${occurrenceCount} event${occurrenceCount === 1 ? '' : 's'} ${action === 'approved' ? 'created' : 'were rejected'}.</p>`
    : '';
  const note = moderatorNote ? `<p>Moderator note: ${esc(moderatorNote)}</p>` : '';
  const body = action === 'approved'
    ? `<p>Your event <strong>${esc(title)}</strong> has been approved and is now visible to people in your area.</p>${recLine}${note}`
    : `<p>Your event submission <strong>${esc(title)}</strong> was not approved.</p>${recLine}${note}<p>You can edit and resubmit from your dashboard.</p>`;
  const text = action === 'approved'
    ? `"${title}" is live on Proactivity${recurrence ? ` (${describeRecurrence(recurrence.freq, recurrence.count, recurrence.skipCount)})` : ''}.\n\nDashboard: ${dashboardUrl()}`
    : `"${title}" was rejected.${moderatorNote ? `\n\nNote: ${moderatorNote}` : ''}\n\nDashboard: ${dashboardUrl()}`;
  await send({ to, subject, html: shell(subject, body), text });
}

/**
 * Email the admin (recipients in ADMIN_NOTIFICATION_EMAIL, comma-separated;
 * falls back to ADMIN_EMAILS) whenever a new pending item lands in any
 * moderation queue. No-ops if neither env var is set.
 */
export async function notifyAdminOfPending(params: {
  kind: 'claim' | 'event_draft' | 'url_submission' | 'contact' | 'contact_general' | 'rating';
  summary: string;
  detail?: string | null;
  submitterEmail?: string | null;
}): Promise<void> {
  const raw = process.env.ADMIN_NOTIFICATION_EMAIL ?? process.env.ADMIN_EMAILS ?? '';
  const recipients = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (recipients.length === 0) return;
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';
  const queueUrl = `${base}/admin/moderate`;
  const isGeneralContact = params.kind === 'contact_general';
  const kindLabel = {
    claim: 'Organizer claim',
    event_draft: 'Event draft',
    url_submission: 'URL submission',
    contact: 'New event submission',
    contact_general: 'Contact form message',
    rating: 'Rating',
  }[params.kind];
  const subject = isGeneralContact
    ? `[Proactivity] Contact form: ${params.summary}`
    : `[Proactivity] ${kindLabel} needs review`;
  const submitter = params.submitterEmail ? `<p style="margin: 8px 0; font-size: 13px; color: #666;">From: ${esc(params.submitterEmail)}</p>` : '';
  const detail = params.detail ? `<p style="margin: 8px 0; color: #444; white-space: pre-wrap;">${esc(params.detail)}</p>` : '';

  // Contact-form messages get a "Reply to sender" mailto CTA. Moderation
  // queue items get an "Open moderation queue" CTA pointing at /admin/moderate.
  const ctaHref = isGeneralContact && params.submitterEmail
    ? `mailto:${params.submitterEmail}`
    : queueUrl;
  const ctaLabel = isGeneralContact
    ? (params.submitterEmail ? `Reply to ${params.submitterEmail}` : 'View site')
    : 'Open moderation queue';
  const heading = isGeneralContact ? 'New message via contact form' : `${esc(kindLabel)} pending`;

  // Optional reminder shown on contact-form notifications so the admin
  // remembers to switch their Gmail "From" to the public alias. Set
  // REPLY_FROM_ADDRESS in env (e.g. "hello@proactivity.app") to enable.
  const replyFromAlias = process.env.REPLY_FROM_ADDRESS?.trim() || null;
  const replyReminderHtml = isGeneralContact && replyFromAlias && params.submitterEmail
    ? `<p style="margin: 16px 0 0; font-size: 12px; color: #888;">Tip: reply <strong>from ${esc(replyFromAlias)}</strong> (switch the From dropdown in Gmail) so your personal address stays private.</p>`
    : '';
  const replyReminderText = isGeneralContact && replyFromAlias && params.submitterEmail
    ? `\n\nTip: reply from ${replyFromAlias} (switch the From dropdown in Gmail) so your personal address stays private.`
    : '';

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #222;">
      <h1 style="font-size: 18px; margin: 0 0 12px;">${heading}</h1>
      ${isGeneralContact ? '' : `<p style="margin: 0 0 4px;">${esc(params.summary)}</p>`}
      ${detail}
      ${submitter}
      <p style="margin: 20px 0 0;">
        <a href="${ctaHref}" style="display: inline-block; padding: 10px 18px; background: #6d28d9; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
          ${esc(ctaLabel)}
        </a>
      </p>
      ${replyReminderHtml}
    </div>
  `;
  const text = isGeneralContact
    ? `New message via contact form${params.submitterEmail ? ` from ${params.submitterEmail}` : ''}${params.detail ? `\n\n${params.detail}` : ''}${params.submitterEmail ? `\n\nReply: mailto:${params.submitterEmail}` : ''}${replyReminderText}`
    : `${kindLabel} pending: ${params.summary}${params.detail ? `\n\n${params.detail}` : ''}${params.submitterEmail ? `\n\nFrom: ${params.submitterEmail}` : ''}\n\n${queueUrl}`;
  await send({ to: recipients.join(','), subject, html, text });
}

export async function notifyUrlSubmissionResolved(params: {
  to: string;
  url: string;
  action: 'imported' | 'rejected' | 'failed';
  importedCount: number | null;
  moderatorNote: string | null;
}): Promise<void> {
  const { to, url, action, importedCount, moderatorNote } = params;
  const subjects = {
    imported: `${importedCount ?? 0} event${importedCount === 1 ? '' : 's'} imported from your submission`,
    rejected: `Your URL submission was rejected`,
    failed: `We couldn't import events from your URL`,
  };
  const subject = subjects[action];
  const note = moderatorNote ? `<p>Note: ${esc(moderatorNote)}</p>` : '';
  const bodies = {
    imported: `<p>We pulled <strong>${importedCount ?? 0} event${importedCount === 1 ? '' : 's'}</strong> from your submitted URL.</p><p style="font-size: 13px; color: #666; word-break: break-all;">${esc(url)}</p>${note}`,
    rejected: `<p>Your URL submission was rejected.</p><p style="font-size: 13px; color: #666; word-break: break-all;">${esc(url)}</p>${note}`,
    failed: `<p>We tried to import events from your submitted URL but couldn't extract any.</p><p style="font-size: 13px; color: #666; word-break: break-all;">${esc(url)}</p>${note}<p>You can submit a different URL or contact us if you think this was a mistake.</p>`,
  };
  const body = bodies[action];
  const text = `${subject}\n\nURL: ${url}${moderatorNote ? `\n\nNote: ${moderatorNote}` : ''}\n\nDashboard: ${dashboardUrl()}`;
  await send({ to, subject, html: shell(subject, body), text });
}
