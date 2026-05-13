import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin-auth';
import EventsTable from './EventsTable';

export const dynamic = 'force-dynamic';

export default async function AdminEventsPage() {
  if (!(await isAdmin())) {
    redirect('/admin/login');
  }
  return <EventsTable />;
}
