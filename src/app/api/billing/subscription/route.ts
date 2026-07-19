// src/app/api/billing/subscription/route.ts
// No file number assigned yet — same open numbering question flagged in
// checkout/route.ts, unresolved.
//
// No `maxDuration` override here, unlike checkout/route.ts and the
// webhook route: this route makes no outbound Cashfree call, only a DB
// read via BillingService.getCurrentSubscription() — Vercel's default
// execution ceiling is assumed sufficient. Flagged as a judgment call by
// analogy (no real network call = no reason to raise it), not a measured
// necessity either way.
//
// Query param `?firmId=` is a fresh, undiscussed convention (this is the
// first GET route in the Billing module) — mirrors createCheckoutSession's
// input.firmId in spirit (optional, firm-scoped when present) but as a
// query string param since this is a GET, not a body field.
//
// Returns 200 with `data: null` when there's no active subscription —
// NOT a 404 — matching getCurrentSubscription()'s own doc comment: "no
// active subscription" is a normal state (never subscribed, or lapsed),
// not a missing resource.
//
// Error handling: AuthenticationError (not logged in), AuthorizationError
// (firmId supplied but caller doesn't own that firm), NotFoundError
// (firmId supplied but no such firm exists — via firmRepository's own
// findByIdOrThrow) all route through the same handleApiError() as every
// other route — no special-casing added here.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildBillingService } from '@/modules/billing/billing.factory';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const firmId = request.nextUrl.searchParams.get('firmId') ?? undefined;

    const billingService = await buildBillingService();
    const subscription = await billingService.getCurrentSubscription(firmId);

    return NextResponse.json({ data: subscription }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}