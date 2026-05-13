import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import OrganizerDashboard from './OrganizerDashboard';

export const dynamic = 'force-dynamic';

export default async function OrganizerPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login?next=/organizer');
  }
  return <OrganizerDashboard />;
}
