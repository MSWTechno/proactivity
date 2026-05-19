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
      initialValues = {
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
