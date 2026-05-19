import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin-auth';
import OrganizationsTable from './OrganizationsTable';

export const dynamic = 'force-dynamic';

export default async function AdminOrganizationsPage() {
  if (!(await isAdmin())) {
    redirect('/admin/login');
  }
  return <OrganizationsTable />;
}
