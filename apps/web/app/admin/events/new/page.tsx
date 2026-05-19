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
  let contactMeta: { id: string; name: string | null; email: string; organization: string | null } | undefined;

  if (params.contactId && UUID_RE.test(params.contactId)) {
    const rows = await db
      .select()
      .from(contactSubmissions)
      .where(eq(contactSubmissions.id, params.contactId))
      .limit(1);
    const sub = rows[0];
    if (sub) {
      // datetime-local inputs expect "YYYY-MM-DDTHH:mm" (no timezone, no seconds).
      const toLocalInput = (iso: string | null | undefined): string => {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      // Newer submissions carry structured event_data; older ones don't.
      // When present, prefill every form field; otherwise fall back to
      // the message text + organization for title/description/organizer.
      const ed = (sub.eventData ?? null) as null | Record<string, unknown>;
      const str = (v: unknown): string => (typeof v === 'string' ? v : '');
      initialValues = ed
        ? {
            title: str(ed.title),
            description: str(ed.description) || sub.message,
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
            description: sub.message ?? '',
            organizerName: sub.organization ?? '',
            url: sub.eventUrl ?? '',
            availability: 'onsale',
          };
      contactMeta = {
        id: sub.id,
        name: sub.name,
        email: sub.email,
        organization: sub.organization,
      };
    }
  }

  return <AddEventForm initialValues={initialValues} contactMeta={contactMeta} />;
}
