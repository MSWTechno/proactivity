import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin-auth';
import SourcesTable from './SourcesTable';

export const dynamic = 'force-dynamic';

export default async function AdminSourcesPage() {
  if (!(await isAdmin())) {
    redirect('/admin/login');
  }
  return <SourcesTable />;
}
