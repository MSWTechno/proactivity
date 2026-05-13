// Stripe billing helpers. Single shared client; subscription state pulled
// from our own `subscriptions` table (kept in sync via webhook).

import Stripe from 'stripe';
import { db, subscriptions, type Subscription } from '@proactivity/db';
import { and, eq, desc } from 'drizzle-orm';

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  _stripe = new Stripe(key);
  return _stripe;
}

export type SubscriptionKind = 'consumer_no_ads' | 'organizer_pro';

/**
 * Latest subscription row for a user/kind, regardless of status. Useful
 * for deciding whether to send a returning user to Stripe Checkout (new
 * subscription) vs Customer Portal (manage existing).
 */
export async function latestSubscription(
  userId: string,
  kind: SubscriptionKind,
): Promise<Subscription | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.kind, kind)))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** True if user has an active or trialing subscription of the given kind. */
export async function hasActiveSubscription(
  userId: string,
  kind: SubscriptionKind,
): Promise<boolean> {
  const sub = await latestSubscription(userId, kind);
  if (!sub) return false;
  return sub.status === 'active' || sub.status === 'trialing';
}

/**
 * Upsert a subscription row from a Stripe Subscription object. Called from
 * the webhook on `customer.subscription.created/updated/deleted` and from
 * the Checkout success flow as a safety net.
 */
export async function upsertSubscriptionFromStripe(
  stripeSub: Stripe.Subscription,
  userId: string,
  kind: SubscriptionKind,
): Promise<void> {
  const periodEnd =
    'current_period_end' in stripeSub && typeof stripeSub.current_period_end === 'number'
      ? new Date(stripeSub.current_period_end * 1000)
      : null;

  await db
    .insert(subscriptions)
    .values({
      userId,
      kind,
      stripeCustomerId:
        typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id,
      stripeSubscriptionId: stripeSub.id,
      status: stripeSub.status,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        status: stripeSub.status,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
        updatedAt: new Date(),
      },
    });
}
