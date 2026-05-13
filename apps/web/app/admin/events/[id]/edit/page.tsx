import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin-auth';
import EditEventForm from './EditEventForm';

export const dynamic = 'force-dynamic';

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    redirect('/admin/login');
  }
  const { id } = await params;
  return <EditEventForm id={id} />;
}
