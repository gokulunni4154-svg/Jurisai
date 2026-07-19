// src/app/pricing/page.tsx
// NEW FILE, THIS SESSION — first piece of Billing module frontend.
// UPDATED, THIS SESSION — CTA now navigates to /pricing/checkout for
// individual/lawyer plans (see that page's own header for the full
// checkout-flow scope and its open redirect-URL TODO). Firm plans now
// route to /billing/firms/new (firm-creation UI, this session) instead
// of staying disabled — see that page's own header for the still-open
// "already own a firm" lookup gap.
//
// SOURCE-VERIFIED AGAINST, THIS SESSION:
//   - GET /api/billing/plans (route.ts, new this session) -> real
//     response shape `{ data: { plans } }`, confirmed because this page
//     and that route were built together against the same
//     PlanRepository#findActive() return type.
//   - `plans` Row shape, via database.types.ts (pasted and decoded from
//     UTF-16 this session): id, slug, name, description, price_paise,
//     billing_interval, billing_target, max_seats, cashfree_plan_id,
//     is_active, created_at, updated_at.
//
// STYLE CONVENTIONS carried over from the real, pasted
// src/app/documents/page.tsx (File 159): font-serif for headings,
// text-[13px]/[12px]/[11px] type scale, bg-primary/text-primary-foreground
// for the main CTA, border-border + bg-card for card surfaces,
// Loader2/AlertCircle from lucide-react for loading/error states, same
// formatRelativeTime-style small-helper-function pattern. No new visual
// language introduced.
//
// FLAGGED, DELIBERATE SCOPE BOUNDARY: this page has NO left-rail nav
// shell (unlike src/app/documents/page.tsx). A pricing/plan catalog is
// the kind of page a logged-out visitor deciding whether to sign up
// would land on — GET /api/billing/plans itself is reachable
// unauthenticated (see that route's own header comment) — so building
// it inside the authenticated dashboard shell would contradict that.
// Judgment call, not confirmed against any actual routing/layout
// decision from you.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Loader2, Scale } from 'lucide-react';

// Declared locally rather than imported from database.types.ts —
// same reasoning as notifications-panel.tsx's own local NotificationRow
// interface: keeps this a plain client component with no server-only
// import chain, while still matching the real, pasted Row shape exactly.
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

function formatPrice(pricePaise: number): string {
  const rupees = pricePaise / 100;
  return rupees.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}

// billing_interval is a plain `string` column (see database.types.ts),
// not a confirmed enum — this only prettifies the common cases seen in
// the migration/progress-doc naming conventions ('monthly', 'yearly')
// and falls back to the raw value for anything else, rather than
// assuming a closed set.
function formatInterval(interval: string): string {
  if (interval === 'monthly') return '/month';
  if (interval === 'yearly') return '/year';
  return `/${interval}`;
}

function formatBillingTarget(target: string): string {
  if (target === 'individual') return 'For individuals';
  if (target === 'lawyer') return 'For lawyers';
  if (target === 'firm') return 'For firms';
  return target;
}

export default function PricingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/plans', { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      const json: ListPlansResponse = await res.json();
      setPlans(json.data.plans);
    } catch {
      setError('Could not load plans. Try again in a moment.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-background font-sans text-foreground">
      {/* Top bar — mirrors src/app/documents/page.tsx's header, minus
          the search/upload controls that don't apply here. */}
      <header className="flex items-center justify-between border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
            <Scale className="h-[18px] w-[18px] text-primary" strokeWidth={1.75} />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              JurisAI
            </p>
            <h1 className="font-serif text-[26px] leading-none text-foreground">Plans</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 px-8 py-10">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading plans…</p>
          </div>
        ) : error ? (
          <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-16 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">{error}</p>
            <button
              onClick={fetchPlans}
              className="text-[13px] font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : plans.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-24 text-muted-foreground">
            <p className="text-[13px]">No plans are available right now.</p>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl">
            <p className="mb-8 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
              Choose the plan that fits how you work with JurisAI. Every plan includes
              document analysis and AI-assisted legal insights.
            </p>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className="flex flex-col rounded-lg border border-border bg-card p-6"
                >
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    {formatBillingTarget(plan.billing_target)}
                  </p>
                  <h2 className="mt-2 font-serif text-[20px] leading-tight text-foreground">
                    {plan.name}
                  </h2>

                  {plan.description && (
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                      {plan.description}
                    </p>
                  )}

                  <div className="mt-5 flex items-baseline gap-1">
                    <span className="font-serif text-[28px] leading-none text-foreground">
                      {formatPrice(plan.price_paise)}
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      {formatInterval(plan.billing_interval)}
                    </span>
                  </div>

                  {plan.max_seats !== null && (
                    <div className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2} />
                      <span>Up to {plan.max_seats} seats</span>
                    </div>
                  )}

                  {plan.billing_target === 'firm' ? (
                    // UPDATED, THIS SESSION — was disabled ("Requires a
                    // firm"). Now that /billing/firms/new exists, this
                    // links there with planSlug carried through so the
                    // firm-creation flow can hand off straight into
                    // checkout once the firm exists. See that page's own
                    // header for the still-open "already own a firm"
                    // lookup gap.
                    <button
                      onClick={() => router.push(`/billing/firms/new?planSlug=${plan.slug}`)}
                      className="mt-6 flex items-center justify-center rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      Get started
                    </button>
                  ) : (
                    <button
                      onClick={() => router.push(`/billing/checkout?planSlug=${plan.slug}`)}
                      className="mt-6 flex items-center justify-center rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      Get started
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}