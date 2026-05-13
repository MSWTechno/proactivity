import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin-auth';
import ModerationDashboard from './ModerationDashboard';

export const dynamic = 'force-dynamic';

export default async function ModeratePage() {
  if (!(await isAdmin())) {
    redirect('/admin/login');
  }
  return <ModerationDashboard />;
}
