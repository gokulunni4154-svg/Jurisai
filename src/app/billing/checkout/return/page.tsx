// src/app/billing/checkout/return/page.tsx
// NEW FILE, THIS SESSION — the post-checkout returnUrl landing page.
// This route is what createCheckoutSession()'s `returnUrl` field
// (billing.service.ts) points at — see checkout/page.tsx's own
// `${window.location.origin}/billing/checkout/return` construction.
// Filling gap item #3 from the prior session's handoff.
//
// SOURCE-VERIFIED AGAINST, THIS SESSION:
//   - GET /api/billing/subscription (route.ts, pasted this session):
//     accepts optional `?firmId=` query param, returns
//     `{ data: subscription }` at 200, where `data` is explicitly `null`
//     — not a 404 — when there's no active subscription. Errors
//     (AuthenticationError/AuthorizationError/NotFoundError-on-bad-firmId)
//     all route through the same handleApiError() shape as every other
//     route, so extractErrorMessage() below (copied from checkout/page.tsx,
//     which itself notes it's reused verbatim from
//     notifications-panel.tsx) is reused unchanged.
//   - BillingService#getCurrentSubscription() (billing.service.ts, pasted
//     this session): return type Promise<SubscriptionRow | null>.
//
// FLAGGED, JUDGMENT CALL — CENTRAL DESIGN DECISION FOR THIS FILE:
// Cashfree's own redirect query params (order_id / subscription_id /
// a status flag — whatever it actually appends) are UNCONFIRMED, same
// root cause as the CheckoutSession.redirectUrl gap: no live sandbox
// response exists to check the real param names against. This page
// deliberately does NOT read or trust any query params Cashfree might
// append to the return URL. Instead it re-fetches
// GET /api/billing/subscription and treats OUR OWN database as the
// single source of truth for what happened. This sidesteps the
// unconfirmed-param gap entirely rather than guessing param names, at
// the cost of not being able to show a Cashfree-specific outcome (e.g.
// "payment failed" vs "payment cancelled by user") if Cashfree would
// have distinguished those in its redirect. Revisit once a live sandbox
// response is inspectable — see billing.service.ts's own CheckoutSession
// TODO for the matching resolution point.
//
// FLAGGED, GAP FOUND WHILE BUILDING THIS FILE — checkout/page.tsx's
// returnUrl, as pasted this session, did NOT carry `firmId` through
// (only `${origin}/billing/checkout/return`, no query string), even
// though GET /api/billing/subscription needs `?firmId=` to resolve a
// FIRM subscription rather than the caller's own profile subscription.
// Without that param, a firm-plan checkout would land here and this
// page would ask for the wrong (profile-scoped) subscription and most
// likely see `data: null` even though a real firm subscription exists.
// This is a small, in-scope correctness fix to checkout/page.tsx
// (appending `?firmId=` to returnUrl when firmId is present) — made
// here rather than left as a separate flagged gap, since this file
// can't function correctly for firm checkouts without it. Diff shown
// separately; not a redesign of that file.
//
// FLAGGED, NOT INDEPENDENTLY CONFIRMED: SubscriptionRow's full column
// set (database.types.ts's `subscriptions` Row type) was never pasted
// this session. Only four fields are directly confirmed as real columns
// — via billing.service.ts's cancelSubscription(), which reads
// `subscription.id` and `subscription.subscription_id` directly and
// spreads `subscription` with overridden `status`/`cancelled_at`,
// meaning all four exist on the real Row type:
//   - id
//   - subscription_id  (merchant-generated ID, NOT cf_subscription_id)
//   - status
//   - cancelled_at
// Deliberately NOT rendering plan name, period dates, or any other
// field (e.g. plan_id, current_period_end, firm_id/profile_id,
// created_at) since none of those were confirmed this session. Revisit
// once database.types.ts is pasted.
//
// FLAGGED, JUDGMENT CALL: no auto-polling. Cashfree's mandate
// authorization is an async, customer-driven step, so the subscription
// `status` this page fetches immediately after redirect may still be
// whatever createCheckoutSession() set at creation time, not yet
// updated by updateSubscriptionStatusFromWebhook(). A manual "Refresh
// status" button is provided instead of a polling interval — polling
// intervals/backoff were never discussed, so not guessed at here.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

// Only the four confirmed fields — see file header note.
interface SubscriptionRow {
  id: string;
  subscription_id: string;
  status: string;
  cancelled_at: string | null;
}

interface GetSubscriptionResponse {
  data: SubscriptionRow | null;
}

// Reused verbatim from checkout/page.tsx, which itself notes this is
// the same shape as notifications-panel.tsx's own extractErrorMessage.
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

export default function CheckoutReturnPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // See file header — the only query param this page reads is our own
  // firmId (added to returnUrl by the checkout/page.tsx fix noted
  // above), never anything Cashfree might append.
  const firmId = searchParams.get('firmId');

  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchSubscription = useCallback(
    async (isRefresh: boolean) => {
      isRefresh ? setIsRefreshing(true) : setIsLoading(true);
      setError(null);
      try {
        const url = firmId
          ? `/api/billing/subscription?firmId=${encodeURIComponent(firmId)}`
          : '/api/billing/subscription';
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(await extractErrorMessage(res));
        const json: GetSubscriptionResponse = await res.json();
        setSubscription(json.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load subscription status.');
      } finally {
        isRefresh ? setIsRefreshing(false) : setIsLoading(false);
      }
    },
    [firmId],
  );

  useEffect(() => {
    fetchSubscription(false);
  }, [fetchSubscription]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-8 py-6">
        <h1 className="font-serif text-[22px] leading-none text-foreground">
          Subscription status
        </h1>
      </header>

      <main className="flex-1 px-8 py-10">
        <div className="mx-auto max-w-md">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Checking your subscription…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-16 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{error}</p>
              <button
                onClick={() => fetchSubscription(false)}
                className="text-[13px] font-medium underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : !subscription ? (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                <h2 className="font-serif text-[18px] text-foreground">
                  No active subscription found
                </h2>
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                We couldn&apos;t find an active subscription{firmId ? ' for this firm' : ''} yet.
                If you just completed checkout, this can take a moment to update.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => fetchSubscription(true)}
                  disabled={isRefreshing}
                  className="flex items-center gap-2 text-[13px] font-medium text-foreground underline underline-offset-2 disabled:opacity-60"
                >
                  {isRefreshing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isRefreshing ? 'Refreshing…' : 'Refresh status'}
                </button>
                <button
                  onClick={() => router.push('/pricing')}
                  className="text-[13px] font-medium text-muted-foreground underline underline-offset-2"
                >
                  Back to plans
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle2 className="h-4 w-4" />
                <h2 className="font-serif text-[18px] text-foreground">Subscription found</h2>
              </div>
              <dl className="flex flex-col gap-2 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subscription ID</dt>
                  <dd className="text-foreground">{subscription.subscription_id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="text-foreground">{subscription.status}</dd>
                </div>
                {subscription.cancelled_at && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Cancelled at</dt>
                    <dd className="text-foreground">
                      {new Date(subscription.cancelled_at).toLocaleString('en-IN')}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] leading-relaxed text-foreground">
                This status is read directly from our own records, not from Cashfree&apos;s
                redirect — its status may take a moment to reflect a just-completed payment
                authorization.
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => fetchSubscription(true)}
                  disabled={isRefreshing}
                  className="flex items-center gap-2 text-[13px] font-medium text-foreground underline underline-offset-2 disabled:opacity-60"
                >
                  {isRefreshing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isRefreshing ? 'Refreshing…' : 'Refresh status'}
                </button>
                <button
                  onClick={() => router.push('/pricing')}
                  className="text-[13px] font-medium text-muted-foreground underline underline-offset-2"
                >
                  Back to plans
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}