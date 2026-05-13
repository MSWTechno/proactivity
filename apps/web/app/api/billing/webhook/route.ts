import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe, upsertSubscriptionFromStripe, type SubscriptionKind } from '@/lib/billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/billing/webhook
 * Stripe webhook receiver. Verifies signature, then keeps our local
 * `subscriptions` table in sync.
 *
 * Required env: STRIPE_WEBHOOK_SECRET
 * Configure the endpoint in Stripe Dashboard → Developers → Webhooks
 * to listen for at least:
 *   - checkout.session.completed
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 */
export async function POST(request: Request) {
  const sig = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: 'missing signature or secret' }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'invalid signature' },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId =
          (session.metadata?.userId as string | undefined) ?? session.client_reference_id ?? null;
        const kind = (session.metadata?.kind ?? 'consumer_no_ads') as SubscriptionKind;
        const subId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (userId && subId) {
          const sub = await stripe().subscriptions.retrieve(subId);
          await upsertSubscriptionFromStripe(sub, userId, kind);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        const kind = (sub.metadata?.kind ?? 'consumer_no_ads') as SubscriptionKind;
        if (userId) {
          await upsertSubscriptionFromStripe(sub, userId, kind);
        }
        break;
      }
      default:
        // Ignore other events (invoice.*, payment_intent.*, etc.)
        break;
    }
  } catch (e) {
    // Log but return 200 so Stripe doesn't retry indefinitely on persistent
    // bugs in our handler.
    console.error('webhook handler error:', e);
    return NextResponse.json({ received: true, error: 'handler error' });
  }

  return NextResponse.json({ received: true });
}
