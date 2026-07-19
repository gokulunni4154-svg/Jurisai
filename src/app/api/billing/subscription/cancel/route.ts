// src/app/api/billing/subscription/cancel/route.ts
// No file number assigned yet — same open numbering question flagged
// throughout the Billing module, unresolved.
//
// Fresh, undiscussed convention: an action-suffixed sub-route
// (/subscription/cancel) rather than adding a POST/DELETE handler to
// GET /api/billing/subscription's own route.ts file. Either shape would
// work; this one was picked so cancel's own maxDuration override (below)
// and its distinct error surface don't need to coexist in the same file
// as the read route — flagged as a judgment call, not a project
// precedent.
//
// Same `maxDuration = 60` reasoning as checkout/route.ts: this route
// makes a real outbound Cashfree call (cashfreeService.manageSubscription
// via billingService.cancelSubscription()), unlike GET
// /api/billing/subscription which only reads the DB.
//
// No request body — mirrors GET /api/billing/subscription's own
// ?firmId= query-param convention rather than accepting an arbitrary
// subscription id from the client. This is a deliberate safety property,
// not just a style choice: the caller can only ever cancel "my own
// subscription" or "a firm I own's subscription," never an arbitrary
// row by id, so there's no separate "does this id belong to you"
// authorization check to get right or wrong.
//
// Error handling: AuthenticationError (not logged in), AuthorizationError
// (firmId supplied but caller doesn't own that firm), NotFoundError
// (firmId supplied but no such firm — via firmRepository's own
// findByIdOrThrow — OR no active subscription to cancel, from
// cancelSubscription() itself), and any CashfreeApiError from the
// Manage Subscription call itself, all route through the same
// handleApiError() as every other route.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildBillingService } from '@/modules/billing/billing.factory';

export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const firmId = request.nextUrl.searchParams.get('firmId') ?? undefined;

    const billingService = await buildBillingService();
    const subscription = await billingService.cancelSubscription(firmId);

    return NextResponse.json({ data: subscription }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}