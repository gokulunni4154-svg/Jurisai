// src/app/api/billing/checkout/route.ts
// No file number assigned yet — first route in the Billing module, no
// prior billing route exists to number-continue from. Assign a real
// number (sequential or a new "Billing File N" track, your call — same
// open question Phase 3 File numbering already went through once).
//
// Route path is a fresh, undiscussed convention: /api/billing/checkout,
// not nested under /documents/[id]/... the way every AI-pipeline route
// is (Path Conventions section covers only that shape) — billing has no
// natural document/analysis parent, so it gets its own top-level
// collection. Flagged as a judgment call, not drawn from any existing
// project convention.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildBillingService } from '@/modules/billing/billing.factory';

/**
 * Same reasoning as every other route in this project that makes an
 * outbound network call it must wait on (Files 67, 98, 106, ..., 168) —
 * raises the execution ceiling from Vercel Hobby's 10s default to 60s.
 * Applied here by analogy (a Cashfree API round-trip is a real network
 * call, same class of risk as an AI provider call), not because this
 * route's real latency has been measured — flagged, not confirmed
 * necessary.
 */
export const maxDuration = 60;

/**
 * POST /api/billing/checkout
 *
 * FLAGGED — no billing.schemas.ts exists yet, so this route does NOT
 * follow this project's established Zod-at-the-Route-boundary discipline
 * (the pattern chat.schemas.ts set with createChatConversationInputSchema/
 * sendMessageInputSchema). Below is a minimal manual shape check only.
 * A real schema file should replace this before treating checkout as
 * production-ready — deliberately not invented here without a real
 * precedent for this module's own input shape to build it against.
 *
 * Validation failures and BillingService's own thrown errors (NotFoundError
 * for a missing/inactive plan, AuthorizationError via requireOwnership()
 * for a firm the caller doesn't own, plain Errors for "no firm-creation
 * flow", "already has an active subscription", etc.) are all routed
 * through the same handleApiError() as every other route — no
 * billing-specific error branching added here.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    if (
      typeof body?.planSlug !== 'string' ||
      typeof body?.returnUrl !== 'string' ||
      typeof body?.customer?.customerName !== 'string' ||
      typeof body?.customer?.customerEmail !== 'string' ||
      typeof body?.customer?.customerPhone !== 'string'
    ) {
      throw new Error(
        'planSlug, returnUrl, and customer.{customerName, customerEmail, customerPhone} are required.',
      );
    }

    const billingService = await buildBillingService();

    const session = await billingService.createCheckoutSession({
      planSlug: body.planSlug,
      firmId: typeof body.firmId === 'string' ? body.firmId : undefined,
      customer: {
        customerName: body.customer.customerName,
        customerEmail: body.customer.customerEmail,
        customerPhone: body.customer.customerPhone,
      },
      returnUrl: body.returnUrl,
    });

    return NextResponse.json({ data: session }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}