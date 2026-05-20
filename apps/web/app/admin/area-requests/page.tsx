import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin-auth';
import AreaRequestsTable from './AreaRequestsTable';

export const dynamic = 'force-dynamic';

export default async function AdminAreaRequestsPage() {
  if (!(await isAdmin())) {
    redirect('/admin/login');
  }
  return <AreaRequestsTable />;
}
