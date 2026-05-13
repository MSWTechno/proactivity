import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { stripe, latestSubscription } from '@/lib/billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/billing/checkout
 * Body: { kind: 'consumer_no_ads' }
 * Creates a Stripe Checkout Session and returns its URL. If the user is
 * already an active subscriber, redirect them to the portal instead.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  }

  let body: { kind?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (body.kind !== 'consumer_no_ads') {
    return NextResponse.json({ error: 'unknown kind' }, { status: 400 });
  }

  const priceId = process.env.STRIPE_PRICE_NO_ADS;
  if (!priceId) {
    return NextResponse.json({ error: 'STRIPE_PRICE_NO_ADS not configured' }, { status: 500 });
  }

  const reqUrl = new URL(request.url);
  const baseUrl =
    process.env.PUBLIC_BASE_URL ?? `${reqUrl.protocol}//${reqUrl.host}`;

  // If the user already has an active subscription, send them to the portal.
  const existing = await latestSubscription(user.id, 'consumer_no_ads');
  if (existing && existing.stripeCustomerId && (existing.status === 'active' || existing.status === 'trialing')) {
    try {
      const portal = await stripe().billingPortal.sessions.create({
        customer: existing.stripeCustomerId,
        return_url: `${baseUrl}/`,
      });
      return NextResponse.json({ url: portal.url, action: 'portal' });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'portal session failed' },
        { status: 500 },
      );
    }
  }

  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/?subscribed=1`,
      cancel_url: `${baseUrl}/pricing`,
      customer_email: existing?.stripeCustomerId ? undefined : user.email,
      customer: existing?.stripeCustomerId ?? undefined,
      client_reference_id: user.id,
      metadata: { userId: user.id, kind: 'consumer_no_ads' },
      subscription_data: {
        metadata: { userId: user.id, kind: 'consumer_no_ads' },
      },
      allow_promotion_codes: true,
    });
    return NextResponse.json({ url: session.url, action: 'checkout' });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'checkout failed' },
      { status: 500 },
    );
  }
}
