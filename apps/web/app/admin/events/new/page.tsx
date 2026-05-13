import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin-auth';
import AddEventForm from './AddEventForm';

export const dynamic = 'force-dynamic';

export default async function AddEventPage() {
  if (!(await isAdmin())) {
    redirect('/admin/login');
  }
  return <AddEventForm />;
}
