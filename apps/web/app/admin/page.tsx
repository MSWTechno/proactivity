import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export default async function AdminIndex() {
  if (await isAdmin()) {
    redirect('/admin/moderate');
  }
  redirect('/admin/login');
}
