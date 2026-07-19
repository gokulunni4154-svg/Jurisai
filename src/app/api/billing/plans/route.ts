// src/app/api/billing/plans/route.ts
// No file number assigned yet — same open numbering question flagged in
// checkout/route.ts and subscription/route.ts, unresolved.
//
// Built directly against the real, pasted subscription/route.ts as a
// structural template: same buildBillingService() + handleApiError()
// shape, same NextRequest/NextResponse signature. No new pattern
// introduced at the route layer.
//
// FLAGGED, DIFFERENT FROM subscription/route.ts IN ONE WAY: this route
// is reachable by a logged-out visitor (a pricing page is meant to be
// browsable before signing up). buildBillingService() still runs
// getCurrentUser() internally and may resolve currentUser to null — that
// is fine here, since BillingService#listActivePlans() (this session,
// new) deliberately never calls requireAuthentication(). No auth check
// was added at this route layer either, matching the Service's own
// unauthenticated-by-design posture rather than duplicating a gate here
// that the Service intentionally doesn't have.
//
// No `maxDuration` override — same reasoning as subscription/route.ts:
// this makes no outbound Cashfree call, only a DB read.
//
// Response shape: `{ data: { plans } }`, not a bare `{ data: plans }` —
// FLAGGED, JUDGMENT CALL: subscription/route.ts returns a bare
// `{ data: subscription }` because it's a single resource, but this is a
// list, so it follows the list-response precedent from
// notifications-panel.tsx's own confirmed `ListNotificationsResponse`
// shape (`{ data: { notifications, ... } }`) instead — object-wrapped,
// not array-at-top-level, for room to add pagination/count fields later
// without a breaking shape change. No `total`/`limit`/`offset` included
// here though, since PlanRepository#findActive() deliberately has no
// pagination (see that method's own doc comment) — nothing to report.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildBillingService } from '@/modules/billing/billing.factory';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const billingService = await buildBillingService();
    const plans = await billingService.listActivePlans();

    return NextResponse.json({ data: { plans } }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}