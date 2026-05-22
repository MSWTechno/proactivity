import { redirect } from 'next/navigation';
import { db, contactSubmissions } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { isAdmin } from '@/lib/admin-auth';
import AddEventForm from './AddEventForm';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AddEventPage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string }>;
}) {
  if (!(await isAdmin())) {
    redirect('/admin/login');
  }

  // If launched from "Mark added" on a contact submission, prefill the form
  // with the submission's data and pass the contactId through so the POST
  // can atomically flip the submission to 'added' alongside the insert.
  const params = await searchParams;
  let initialValues: Record<string, string> | undefined;
  let contactMeta: { id: string; name: string | null; email: string; organization: string | null; message: string } | undefined;

  if (params.contactId && UUID_RE.test(params.contactId)) {
    const rows = await db
      .select()
      .from(contactSubmissions)
      .where(eq(contactSubmissions.id, params.contactId))
      .limit(1);
    const sub = rows[0];
    if (sub) {
      // datetime-local inputs expect "YYYY-MM-DDTHH:mm" with no timezone.
      // This runs server-side (Vercel = UTC), so `.getHours()` returns
      // UTC hours and the admin sees the time shifted by their local
      // offset (a 6pm ET event renders as "22:00" in the form). Convert
      // explicitly via Intl in America/New_York since every active
      // source serves VA/Eastern events. If we ever ingest Pacific
      // events we'd plumb the timezone from event_data here instead.
      const toLocalInput = (iso: string | null | undefined): string => {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        // formatToParts in en-CA gives ISO-friendly numeric tokens.
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/New_York',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(d);
        const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
        // hour can come back as "24" at midnight in some ICU builds — normalize.
        const hh = get('hour') === '24' ? '00' : get('hour');
        return `${get('year')}-${get('month')}-${get('day')}T${hh}:${get('minute')}`;
      };
      // Newer submissions carry structured event_data; older ones don't.
      // When present, prefill every form field from event_data only —
      // NEVER from sub.message. The message field is the submitter's
      // free-text note to the admin (or, for admin-scraped batches,
      // internal provenance like "Admin-scraped from <url>") and must
      // not auto-flow into the public activity description. If a legacy
      // (no event_data) submission has nothing in event_data, the admin
      // gets blank fields and has to type a description themselves —
      // small UX friction for a real privacy win.
      const ed = (sub.eventData ?? null) as null | Record<string, unknown>;
      const str = (v: unknown): string => (typeof v === 'string' ? v : '');
      initialValues = ed
        ? {
            title: str(ed.title),
            description: str(ed.description),
            startAt: toLocalInput(str(ed.startAt)),
            endAt: toLocalInput(str(ed.endAt)),
            venueName: str(ed.venueName),
            address: str(ed.address),
            city: str(ed.city),
            region: str(ed.region) || 'VA',
            url: sub.eventUrl ?? '',
            imageUrl: str(ed.imageUrl),
            costMin: ed.costMin != null ? String(ed.costMin) : '',
            costMax: ed.costMax != null ? String(ed.costMax) : '',
            ageMin: ed.ageMin != null ? String(ed.ageMin) : '',
            ageMax: ed.ageMax != null ? String(ed.ageMax) : '',
            categories: str(ed.categories),
            organizerName: sub.organization ?? '',
            availability: 'onsale',
          }
        : {
            title: sub.organization ?? '',
            description: '',
            organizerName: sub.organization ?? '',
            url: sub.eventUrl ?? '',
            availability: 'onsale',
          };
      contactMeta = {
        id: sub.id,
        name: sub.name,
        email: sub.email,
        organization: sub.organization,
        message: sub.message,
      };
    }
  }

  return <AddEventForm initialValues={initialValues} contactMeta={contactMeta} />;
}
