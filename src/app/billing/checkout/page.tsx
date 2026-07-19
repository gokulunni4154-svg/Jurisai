// src/app/billing/checkout/page.tsx
// NEW FILE, THIS SESSION — checkout button/flow, individual/lawyer
// plans only. Firm-plan checkout is out of scope here — see
// src/app/pricing/page.tsx's own comment on why that CTA stays disabled.
// MOVED, THIS SESSION — originally src/app/pricing/checkout/page.tsx,
// relocated under billing/ so all post-click billing pages
// (checkout, firms/new, future subscription view) live together,
// matching the already-unified /api/billing/* backend convention.
// pricing/page.tsx stays a standalone public landing page.
//
// SOURCE-VERIFIED AGAINST, THIS SESSION:
//   - POST /api/billing/checkout (route.ts, pasted this session) -> real
//     request handling: `createCheckoutSchema.parse(body)` then
//     `billingService.createCheckoutSession(input)`, response
//     `{ data: session }` at 201.
//   - BillingService#createCheckoutSession()'s real input type
//     (billing.service.ts, pasted this session): `{ planSlug, firmId?,
//     customer: { customerName, customerEmail, customerPhone },
//     returnUrl }`. This page only ever sends planSlug/customer/returnUrl
//     — firmId is omitted entirely, matching resolveOwner()'s own
//     'individual' | 'lawyer' branch, which never reads firmId.
//   - GET /api/billing/plans (route.ts, this session) -> reused here
//     (not a new endpoint) just to look up the selected plan's display
//     details (name, price) by the planSlug in the query string, since
//     there's no separate "get one plan" route.
//
// FLAGGED, NOT INDEPENDENTLY CONFIRMED: `createCheckoutSchema` itself
// (billing.schemas.ts) was never pasted this session — only its call
// site (`.parse(body)` in checkout/route.ts) and the resulting typed
// `input` it's assigned to (CreateCheckoutSessionInput) were seen. This
// page's request body is built to match CreateCheckoutSessionInput
// exactly, on the assumption the real Zod schema mirrors that type
// field-for-field (a very likely but not literally pasted-and-confirmed
// assumption, since `input` is passed directly into
// createCheckoutSession() with no intermediate mapping visible anywhere
// pasted so far). Revisit if the real schema turns out to use different
// field names.
//
// OPEN TODO, CENTRAL TO THIS FILE — this session doesn't have Cashfree
// sandbox/production credentials configured yet (per direct confirmation
// from you), so there is no real API response to inspect for a
// redirect/payment-authorization URL. See billing.service.ts's own
// matching TODO on CheckoutSession. Once that's resolved: replace the
// "awaiting redirect" success state below with an actual
// `window.location.href = session.redirectUrl` (or equivalent) the
// moment that field is confirmed and added to CheckoutSession.
//
// FLAGGED, JUDGMENT CALL: `returnUrl` is sent as
// `${window.location.origin}/billing/checkout/return` — a route that
// does NOT exist yet ("post-checkout returnUrl landing page" is its own
// separate pending item, not built here). createCheckoutSession()'s
// input requires a returnUrl string with no documented fallback, so
// something has to be sent; this points at where that page will live
// once built, rather than a placeholder value disconnected from the
// project's own naming.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

interface PlanRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_paise: number;
  billing_interval: string;
  billing_target: string;
  max_seats: number | null;
  cashfree_plan_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ListPlansResponse {
  data: {
    plans: PlanRow[];
  };
}

// Matches CheckoutSession from billing.service.ts exactly — no
// redirectUrl field, see this file's own header TODO.
interface CheckoutSession {
  subscriptionId: string;
  cfSubscriptionId: string | null;
  status: string;
}

interface CreateCheckoutResponse {
  data: CheckoutSession;
}

function formatPrice(pricePaise: number): string {
  const rupees = pricePaise / 100;
  return rupees.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}

// Same shape as notifications-panel.tsx's own extractErrorMessage —
// reused verbatim for consistency rather than inventing a new error
// -parsing convention for this one page.
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

export default function CheckoutPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planSlug = searchParams.get('planSlug');
  // NEW, THIS SESSION — populated when arriving from
  // /billing/firms/new's hand-off (either right after creating a firm,
  // or via its manual-ID fallback for someone who already owns one).
  // Absent for individual/lawyer checkout, where createCheckoutSession()
  // never reads firmId at all.
  const firmId = searchParams.get('firmId');

  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [isLoadingPlan, setIsLoadingPlan] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [session, setSession] = useState<CheckoutSession | null>(null);

  const fetchPlan = useCallback(async () => {
    if (!planSlug) {
      setPlanError('No plan selected.');
      setIsLoadingPlan(false);
      return;
    }
    setIsLoadingPlan(true);
    setPlanError(null);
    try {
      const res = await fetch('/api/billing/plans', { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: ListPlansResponse = await res.json();
      const found = json.data.plans.find((p) => p.slug === planSlug) ?? null;
      if (!found) {
        setPlanError('This plan is no longer available.');
      }
      setPlan(found);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Could not load this plan.');
    } finally {
      setIsLoadingPlan(false);
    }
  }, [planSlug]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planSlug) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          planSlug,
          ...(firmId ? { firmId } : {}),
          customer: {
            customerName,
            customerEmail,
            customerPhone,
          },
          // FIXED, THIS SESSION — previously omitted firmId entirely,
          // which would have made the new return page (billing/checkout
          // /return) query GET /api/billing/subscription without
          // ?firmId=, resolving the wrong (profile-scoped) subscription
          // for firm checkouts. See return/page.tsx's own header note.
          returnUrl: `${window.location.origin}/billing/checkout/return${
            firmId ? `?firmId=${encodeURIComponent(firmId)}` : ''
          }`,
        }),
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: CreateCheckoutResponse = await res.json();
      setSession(json.data);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Checkout failed for an unknown reason.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-8 py-6">
        <button
          onClick={() => router.push('/pricing')}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50"
          aria-label="Back to plans"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="font-serif text-[22px] leading-none text-foreground">Checkout</h1>
      </header>

      <main className="flex-1 px-8 py-10">
        <div className="mx-auto max-w-md">
          {isLoadingPlan ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading plan…</p>
            </div>
          ) : planError || !plan ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-16 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{planError ?? 'Plan not found.'}</p>
              <button
                onClick={() => router.push('/pricing')}
                className="text-[13px] font-medium underline underline-offset-2"
              >
                Back to plans
              </button>
            </div>
          ) : session ? (
            // OPEN TODO — see file header. This is the "awaiting
            // redirect" state standing in for a real
            // window.location.href redirect until a real Cashfree
            // response confirms the field to redirect to.
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
              <h2 className="font-serif text-[18px] text-foreground">Subscription created</h2>
              <dl className="flex flex-col gap-2 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subscription ID</dt>
                  <dd className="text-foreground">{session.subscriptionId}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="text-foreground">{session.status}</dd>
                </div>
              </dl>
              <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] leading-relaxed text-foreground">
                Payment authorization isn't wired up yet — Cashfree credentials
                haven't been configured, so there's nowhere to redirect you to
                complete payment. This subscription record was created, but
                won't be usable until that's finished.
              </div>
              <button
                onClick={() => router.push('/pricing')}
                className="text-[13px] font-medium text-muted-foreground underline underline-offset-2"
              >
                Back to plans
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6 rounded-lg border border-border bg-card p-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  {plan.billing_target === 'lawyer' ? 'For lawyers' : 'For individuals'}
                </p>
                <h2 className="mt-1 font-serif text-[18px] text-foreground">{plan.name}</h2>
                <p className="mt-2 text-[15px] text-foreground">
                  {formatPrice(plan.price_paise)}{' '}
                  <span className="text-[13px] text-muted-foreground">
                    /{plan.billing_interval}
                  </span>
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground" htmlFor="customerName">
                    Full name
                  </label>
                  <input
                    id="customerName"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground" htmlFor="customerEmail">
                    Email
                  </label>
                  <input
                    id="customerEmail"
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground" htmlFor="customerPhone">
                    Phone
                  </label>
                  <input
                    id="customerPhone"
                    type="tel"
                    required
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                {submitError && (
                  <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{submitError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-2 flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isSubmitting ? 'Creating subscription…' : 'Continue'}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}