import { NextRequest, NextResponse } from 'next/server';

import { getBillingEnv } from '@/core/config/env.billing';
import { verifyCashfreeWebhookSignature } from '@/modules/billing/cashfree-webhook-signature';
import {
  cashfreeSubscriptionStatusChangedSchema,
  cashfreeWebhookEnvelopeSchema,
} from '@/modules/billing/billing.schemas';
import { buildBillingService } from '@/modules/billing/billing.factory';

/**
 * POST /api/billing/webhooks/cashfree
 * -------------------------------------
 * Receives Cashfree's subscription lifecycle events. Currently handles
 * only SUBSCRIPTION_STATUS_CHANGED — the event that updates
 * subscriptions.status, which is the whole reason this route exists
 * (closing the loop this project was missing since Billing started:
 * nothing previously updated a subscription's status after checkout).
 * Cashfree also sends SUBSCRIPTION_PAYMENT_SUCCESS,
 * SUBSCRIPTION_PAYMENT_FAILED, SUBSCRIPTION_AUTH_STATUS, and others —
 * deliberately NOT handled here yet, since nothing in this project
 * currently reads or stores anything from those events. Extend this
 * route's `switch` when there's a real reason to.
 *
 * FIXED — this route previously imported/called a `createBillingService`
 * that doesn't exist in the real, pasted `billing.factory.ts`. The real
 * factory exports `buildBillingService()`: no arguments (it resolves
 * `currentUser` internally via `getCurrentUser()`, which will resolve to
 * null for this unauthenticated webhook request — matching this route's
 * intent), and it's `async`. Corrected below to `await buildBillingService()`.
 *
 * UPDATED (V1 production blocker fix) — CASHFREE_WEBHOOK_SECRET is read
 * through `getBillingEnv()` (env.billing.ts), not the core `serverEnv`
 * singleton. This was previously read via `serverEnv.CASHFREE_WEBHOOK_SECRET`,
 * which meant a missing secret threw at app boot/cold-start via
 * serverEnv's eager module-level `loadServerEnv()` call — the exact
 * problem this fix removes, since serverEnv is imported transitively by
 * ~40 files including auth. getBillingEnv() validates lazily, on this
 * route actually being invoked, and throws the same kind of controlled
 * configuration error if the secret is missing — so a misconfigured
 * webhook still fails clearly, just without taking the rest of the app
 * down with it.
 *
 * WHY RAW BODY: request.json() would re-serialize the payload before
 * this handler ever sees the original bytes, and Cashfree's signature is
 * computed over the *exact* raw bytes they sent -- any difference in key
 * order or whitespace breaks verification. request.text() is used
 * instead, and the string is manually JSON.parse()'d only AFTER
 * signature verification succeeds.
 *
 * WHY ALWAYS 200: Cashfree retries webhook delivery on non-2xx
 * responses. An unrecognized event `type`, or a valid signature for a
 * cf_subscription_id this app doesn't recognize (see the service
 * method's own comment), are not delivery failures -- returning
 * anything other than 200 for those would cause Cashfree to retry
 * indefinitely for a condition retrying can never fix. Only a signature
 * verification failure returns a non-200 (401), since that's the one
 * case where re-delivery might legitimately help (e.g. a transient
 * header-corruption issue) and where accepting the payload would be
 * unsafe regardless.
 */
export async function POST(request: NextRequest) {
  const secret = getBillingEnv().CASHFREE_WEBHOOK_SECRET;

  const rawBody = await request.text();
  const timestamp = request.headers.get('x-webhook-timestamp');
  const signature = request.headers.get('x-webhook-signature');

  if (!timestamp || !signature) {
    return NextResponse.json({ error: 'Missing webhook signature headers.' }, { status: 401 });
  }

  const isValid = verifyCashfreeWebhookSignature(timestamp, rawBody, signature, secret);

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Valid signature over unparseable JSON shouldn't happen in
    // practice, but fail closed rather than let JSON.parse throw
    // uncaught.
    return NextResponse.json({ error: 'Malformed webhook payload.' }, { status: 400 });
  }

  const envelope = cashfreeWebhookEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    // Always 200 here -- see header comment, "WHY ALWAYS 200".
    return NextResponse.json({ received: true });
  }

  if (envelope.data.type !== 'SUBSCRIPTION_STATUS_CHANGED') {
    // Recognized envelope, unhandled event type -- see header comment.
    return NextResponse.json({ received: true });
  }

  const parsed = cashfreeSubscriptionStatusChangedSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('SUBSCRIPTION_STATUS_CHANGED payload failed validation', parsed.error);
    return NextResponse.json({ received: true });
  }

  const billingService = await buildBillingService();

  await billingService.updateSubscriptionStatusFromWebhook(
    parsed.data.data.subscription_details.cf_subscription_id,
    parsed.data.data.subscription_details.subscription_status,
  );

  return NextResponse.json({ received: true });
}