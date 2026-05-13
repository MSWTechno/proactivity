import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { hasActiveSubscription } from '@/lib/billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null, subscription: null });
  let noAdsActive = false;
  let organizerProActive = false;
  try {
    [noAdsActive, organizerProActive] = await Promise.all([
      hasActiveSubscription(user.id, 'consumer_no_ads'),
      hasActiveSubscription(user.id, 'organizer_pro'),
    ]);
  } catch {
    /* STRIPE not configured locally — treat as no subscription */
  }
  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name },
    subscription: { noAds: noAdsActive, organizerPro: organizerProActive },
  });
}
