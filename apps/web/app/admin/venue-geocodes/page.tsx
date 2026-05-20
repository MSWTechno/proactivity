import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin-auth';
import VenueGeocodesTable from './VenueGeocodesTable';

export const dynamic = 'force-dynamic';

export default async function AdminVenueGeocodesPage() {
  if (!(await isAdmin())) {
    redirect('/admin/login');
  }
  return <VenueGeocodesTable />;
}
