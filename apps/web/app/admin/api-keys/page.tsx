import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin-auth';
import ApiKeysTable from './ApiKeysTable';

export const dynamic = 'force-dynamic';

export default async function AdminApiKeysPage() {
  if (!(await isAdmin())) {
    redirect('/admin/login');
  }
  return <ApiKeysTable />;
}
