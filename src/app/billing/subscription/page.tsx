// src/app/billing/subscription/page.tsx
// NEW FILE, THIS SESSION — the subscription status/cancel view. Filling
// gap item #4 from the handoff prompt. Lives under billing/, matching
// the folder convention settled two sessions ago (everything past "you
// clicked a plan" lives under billing/, not pricing/).
//
// SOURCE-VERIFIED AGAINST, THIS SESSION:
//   - GET /api/billing/subscription (route.ts, pasted last session):
//     optional `?firmId=` query param, `{ data: subscription }` at 200,
//     `data: null` (not 404) when there's no active subscription.
//   - POST /api/billing/subscription/cancel (route.ts, pasted THIS
//     session): same `?firmId=` query-param convention, NO request body
//     (deliberate — per that route's own comment, cancel only ever acts
//     on "my own subscription" or "a firm I own's subscription," never
//     an arbitrary id passed by the client). Returns
//     `{ data: subscription }` at 200 with the already-updated row.
//   - BillingService#cancelSubscription() (billing.service.ts, pasted
//     two sessions ago): throws NotFoundError if there's no active
//     subscription to cancel — this is surfaced as a normal error state
//     below, not treated as a bug, since the user could in theory land
//     here with a stale page after already cancelling elsewhere.
//
// FLAGGED, NOT INDEPENDENTLY CONFIRMED — same as return/page.tsx: only
// four SubscriptionRow fields are confirmed real columns (id,
// subscription_id, status, cancelled_at), via cancelSubscription()'s own
// spread/update usage. Nothing else (plan_id, period dates, firm_id/
// profile_id, created_at) is rendered here either, for the same reason.
//
// FLAGGED, JUDGMENT CALL: no confirmation dialog component exists
// anywhere pasted so far, so the cancel action is gated behind a plain
// `window.confirm()` rather than a styled modal — revisit if/when a
// real confirm-dialog component gets pasted in a future session.
//
// FLAGGED, JUDGMENT CALL: "already cancelled" is inferred from
// `cancelled_at` being non-null (confirmed field), NOT from checking
// `status` against a specific string — the real enum of possible
// `status` values was never pasted this session, so nothing here
// branches on a guessed status string. The cancel button is hidden
// once `cancelled_at` is set; otherwise it's always shown, regardless
// of what `status` currently reads.
//
// FLAGGED, GAP: this page reads an optional `?firmId=` query param
// (same convention as both routes it calls) for consistency, but no
// other page currently links here WITH a firmId — there's no firm
// dashboard yet to link from. Reachable today only unscoped (a user's
// own profile subscription) via direct navigation; the firmId path is
// wired up and ready but currently orphaned. Not treated as a blocker
// since the route-level support costs nothing to include now.
//
// UPDATED, THIS SESSION — this page is no longer reachable ONLY by
// direct URL: documents/page.tsx's left rail now links here (new
// CreditCard button). This page didn't previously offer any way back
// into the main app, only "Back to plans" (→ /pricing) — added a back
// button in the header below, matching checkout/page.tsx's and
// firms/new/page.tsx's existing ArrowLeft pattern, pointing at
// /documents specifically (not router.back(), since this page can now
// also be reached from return/page.tsx's flow, where "back" wouldn't
// reliably mean "the main app").

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2, XCircle } from 'lucide-react';

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

// Reused verbatim from checkout/page.tsx and return/page.tsx.
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

export default function SubscriptionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const firmId = searchParams.get('firmId');

  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const subscriptionUrl = firmId
    ? `/api/billing/subscription?firmId=${encodeURIComponent(firmId)}`
    : '/api/billing/subscription';
  const cancelUrl = firmId
    ? `/api/billing/subscription/cancel?firmId=${encodeURIComponent(firmId)}`
    : '/api/billing/subscription/cancel';

  const fetchSubscription = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(subscriptionUrl, { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: GetSubscriptionResponse = await res.json();
      setSubscription(json.data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load subscription status.');
    } finally {
      setIsLoading(false);
    }
  }, [subscriptionUrl]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const handleCancel = async () => {
    if (!window.confirm('Cancel this subscription? This cannot be undone.')) return;

    setIsCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(cancelUrl, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: GetSubscriptionResponse = await res.json();
      setSubscription(json.data);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Could not cancel subscription.');
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-8 py-6">
        <button
          onClick={() => router.push('/documents')}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50"
          aria-label="Back to documents"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="font-serif text-[22px] leading-none text-foreground">Subscription</h1>
      </header>

      <main className="flex-1 px-8 py-10">
        <div className="mx-auto max-w-md">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading subscription…</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-16 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{loadError}</p>
              <button
                onClick={() => fetchSubscription()}
                className="text-[13px] font-medium underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : !subscription ? (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
              <h2 className="font-serif text-[18px] text-foreground">No active subscription</h2>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                You don&apos;t have an active subscription{firmId ? ' for this firm' : ''} right
                now.
              </p>
              <button
                onClick={() => router.push('/pricing')}
                className="w-fit text-[13px] font-medium text-foreground underline underline-offset-2"
              >
                View plans
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
              <h2 className="font-serif text-[18px] text-foreground">Your subscription</h2>
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

              {cancelError && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{cancelError}</span>
                </div>
              )}

              {!subscription.cancelled_at && (
                <button
                  onClick={handleCancel}
                  disabled={isCancelling}
                  className="mt-2 flex items-center justify-center gap-2 rounded-md border border-destructive/30 px-4 py-2.5 text-[13px] font-medium text-destructive transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCancelling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  {isCancelling ? 'Cancelling…' : 'Cancel subscription'}
                </button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}