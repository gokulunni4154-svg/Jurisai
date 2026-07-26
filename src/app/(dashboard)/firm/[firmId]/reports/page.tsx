// Real path: FLAGGED, UNVERIFIED -- src/app/(dashboard)/firm/[firmId]/reports/page.tsx
// Inferred as a sibling of firm-dashboard's own page
// (src/app/(dashboard)/firm/[firmId]/page.tsx) and firm-settings' own page
// (src/app/(dashboard)/firm/[firmId]/settings/page.tsx), both real, pasted
// this session -- same route-group-parentheses-not-in-URL assumption
// those files already flag, not independently re-verified here.
//
// NEW PAGE, THIS SESSION -- Reports & Analytics frontend, File 5 of 5.
// Consumes GET /api/firms/${firmId}/reports (this session's own File 4),
// which wraps ReportsService#getFirmDashboard() (this session's own File
// 2, real pasted source).
//
// STYLING: deliberately matches firm-dashboard/page.tsx (real, pasted
// this session) everywhere a direct equivalent exists -- slate palette,
// rounded-md borders, same loading-spinner, error-banner, and
// forbidden-state markup and copy pattern, same shortId()/
// formatTimestamp() helpers duplicated inline rather than imported from
// a shared util -- no shared utils module was confirmed to exist this
// session, and both firm-dashboard/page.tsx and firm-settings/page.tsx
// already duplicate these same helpers themselves rather than sharing
// them, so this follows that same precedent, not a new decision.
//
// READ-ONLY PAGE: like firm-dashboard/page.tsx (not firm-settings/
// page.tsx) -- ReportsService only exposes getFirmDashboard(), a pure
// read, so this page has no forms, no mutations, no per-row action
// state.
//
// VISIBILITY HANDLING: identical to both real pasted precedents -- a 403
// from the route (caller not 'owner'/'admin' per ReportsService's own
// requireDashboardAccess()) renders the same dedicated forbidden
// message, not the generic error banner.
//
// FLAGGED, NEW LAYOUT DECISION, NO DIRECT PRECEDENT: firm-dashboard/
// page.tsx renders 3 sections in a md:grid-cols-3 layout. This page's
// data shape (FirmDashboard from reports.service.ts) has 4 top-level
// sections -- cases, tasks, upcomingHearings, subscription -- so this
// uses md:grid-cols-2 (2x2) instead of extending to a 4-up single row,
// which felt too cramped for the subscription section's different shape
// (a single summary block, not a list). A real, deliberate layout
// choice, not inferred from pasted source.
//
// CASE/TASK COUNTS RENDERING: cases and tasks arrive pre-aggregated as
// CaseStatusCounts / TaskStatusCounts ({ total, byStatus }), not raw
// rows -- unlike firm-dashboard/page.tsx, which lists individual case/
// task rows. Rendered here as a total plus a status:count breakdown
// list, the natural fit for that shape. byStatus key order follows
// Object.entries() (insertion order from the repository's own reduce),
// not a fixed status ordering -- reports.repository.ts's own comment
// confirms no canonical status list is available in pasted source to
// sort against.
//
// SUBSCRIPTION SECTION, UPDATED THIS TURN: database.types.ts has now
// been pasted and confirmed real. Per the standing "update the file
// immediately" rule, the earlier placeholder-only rendering (status
// field alone, everything else typed unknown) is replaced below with
// the real subscriptions/plans Row shapes -- subscription.status,
// .current_period_start/_end, .cancelled_at; plan.name, .price_paise,
// .billing_interval, .billing_target, .slug. Currency display
// (price_paise -> INR via Intl.NumberFormat) is a NEW, FLAGGED
// decision -- no currency-formatting precedent exists anywhere in this
// project's pasted source (only date/timestamp formatting, via
// formatTimestamp() above), so the exact display convention
// (paise->rupees division, 'en-IN'/'INR' options) is inferred from the
// column name and this project's existing en-IN locale choice for
// dates, not confirmed against a real pasted formatter. plan.slug,
// .billing_target, .description, .is_active, .max_seats,
// .cashfree_plan_id and subscription.id, .plan_id, .profile_id,
// .subscription_id, .cashfree_subscription_id are all real confirmed
// fields too but deliberately NOT rendered -- out of scope for a
// dashboard summary card, not a gap.
//
// STILL UNRESOLVED, NOT ADDRESSED BY THIS UPDATE: database.types.ts
// shows column shapes only, not constraints/indexes -- it does NOT
// confirm reports.repository.ts#getActiveSubscription()'s "at most one
// non-terminal subscription per firm" assumption (that still rests on
// an unseen partial unique index), and subscriptions.status /
// plans.billing_interval are both plain `string` columns here, not
// Enums-block literal unions -- so NON_TERMINAL_SUBSCRIPTION_STATUSES
// in reports.repository.ts remains a hand-copied list, not something
// this file lets you derive or validate against a real enum.
//
// NO FIRM-NAME LOOKUP: same gap firm-dashboard/page.tsx already flags --
// no GET /api/firms/${firmId}-style single-firm-name route was
// confirmed reachable from a read-only member context this session, so
// the header falls back to a shortened firmId only, same as that file.
// (firm-settings/page.tsx's real fetch of /api/firms/${firmId} is
// gated to the same owner/admin roles this page already requires, so
// reusing it here would add no new access risk -- but wasn't pasted as
// confirmed-safe to reuse for a *reports* page specifically, so left
// out rather than assumed.)
//
// NO PAGINATION: matches both real pasted precedents -- getFirmDashboard()
// takes no limit/offset (its only limit param, hearingsLimit, is fixed
// server-side per File 4's own flagged decision not to expose it as a
// query param), so there is no "Load more" UI here either.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface StatusCounts {
  total: number;
  byStatus: Record<string, number>;
}

interface ReportsHearing {
  id: string;
  firm_id: string;
  case_id: string;
  created_by: string;
  hearing_date: string;
  hearing_type: string;
  court_name: string | null;
  location: string | null;
  notes: string | null;
  outcome: string | null;
  reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

// Real, confirmed shape -- subscriptions/plans Row types from pasted
// database.types.ts. See file-level "SUBSCRIPTION SECTION" comment.
interface ReportsSubscriptionSummary {
  subscription: {
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
    cancelled_at: string | null;
  };
  plan: {
    name: string;
    price_paise: number;
    billing_interval: string;
  };
}

interface FirmDashboardData {
  cases: StatusCounts;
  tasks: StatusCounts;
  upcomingHearings: ReportsHearing[];
  subscription: ReportsSubscriptionSummary | null;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// FLAGGED, NEW: no currency-formatting precedent exists in this
// project's pasted source. Inferred from the confirmed `price_paise`
// column name (integer paise, 1/100 rupee) and this project's existing
// 'en-IN' locale choice for dates -- not itself confirmed against a
// real pasted formatter.
function formatPricePaise(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export default function FirmReportsPage({ params }: { params: { firmId: string } }) {
  const firmId = params.firmId;

  const [data, setData] = useState<FirmDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const res = await fetch(`/api/firms/${firmId}/reports`);

      if (res.status === 403) {
        setForbidden(true);
        return;
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to load reports.');

      setData(json.data as FirmDashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports.');
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const headerTitle = `Firm ${shortId(firmId)}`;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {headerTitle}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Reports &amp; analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          Firm-wide case and task status, upcoming hearings, and subscription --
          visible only to firm owners and admins.
        </p>
      </div>

      {loading ? (
        <div className="mt-10 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : forbidden ? (
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Reports are only visible to this firm&apos;s owner or admins.
        </div>
      ) : error ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : data ? (
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Cases */}
          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              Cases <span className="font-normal text-slate-400">({data.cases.total})</span>
            </h2>

            {Object.keys(data.cases.byStatus).length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No cases yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {Object.entries(data.cases.byStatus).map(([status, count]) => (
                  <li
                    key={status}
                    className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-2.5"
                  >
                    <span className="text-sm text-slate-700">{status}</span>
                    <span className="text-sm font-medium text-slate-900">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Tasks */}
          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              Tasks <span className="font-normal text-slate-400">({data.tasks.total})</span>
            </h2>

            {Object.keys(data.tasks.byStatus).length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No tasks yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {Object.entries(data.tasks.byStatus).map(([status, count]) => (
                  <li
                    key={status}
                    className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-2.5"
                  >
                    <span className="text-sm text-slate-700">{status}</span>
                    <span className="text-sm font-medium text-slate-900">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Upcoming hearings */}
          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              Upcoming hearings{' '}
              <span className="font-normal text-slate-400">
                ({data.upcomingHearings.length})
              </span>
            </h2>

            {data.upcomingHearings.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No upcoming hearings.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.upcomingHearings.map((h) => (
                  <li
                    key={h.id}
                    className="rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <p className="text-sm font-medium text-slate-900">{h.hearing_type}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatTimestamp(h.hearing_date)}
                      {h.court_name ? ` · ${h.court_name}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Subscription -- see file-level "SUBSCRIPTION SECTION" comment
              above: real confirmed fields, rendered now that
              database.types.ts has been pasted this session. */}
          <section>
            <h2 className="text-sm font-semibold text-slate-900">Subscription</h2>

            {data.subscription === null ? (
              <p className="mt-3 text-sm text-slate-500">No active subscription.</p>
            ) : (
              <div className="mt-3 rounded-md border border-slate-200 bg-white px-4 py-3">
                <p className="text-sm font-medium text-slate-900">
                  {data.subscription.plan.name}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {data.subscription.subscription.status} ·{' '}
                  {formatPricePaise(data.subscription.plan.price_paise)}/
                  {data.subscription.plan.billing_interval}
                </p>
                {data.subscription.subscription.current_period_end && (
                  <p className="mt-1 text-xs text-slate-500">
                    Renews {formatTimestamp(data.subscription.subscription.current_period_end)}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}