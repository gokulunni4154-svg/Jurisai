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
import { createCheckoutSchema } from '@/modules/billing/billing.schemas';

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
 * FIXED — this route previously called createCheckoutSchema.safeParse()
 * and, on failure, threw a plain `Error` with the flattened field errors
 * JSON-stringified into the message. Once error-handler.ts was pasted
 * and verified this session, that turned out to be wrong:
 * normalizeError() only converts a genuine ZodError into a client-facing
 * ValidationError (proper 400, real field errors exposed in the
 * response). A plain Error falls through to InternalServerError, which
 * deliberately hides the original message from the client and returns a
 * generic 500 — so checkout validation failures were silently
 * unhelpful to any real client. Switched to `.parse()`, matching the
 * firms route's already-correct pattern (let the real ZodError throw
 * and propagate to handleApiError, which is built specifically to
 * catch it).
 *
 * Validation failures and BillingService's own thrown errors (NotFoundError
 * for a missing/inactive plan, AuthorizationError via requireOwnership()
 * for a firm the caller doesn't own, ConflictError for "already has an
 * active subscription", plain Errors for "no firm-creation flow", etc.)
 * are all routed through the same handleApiError() as every other route
 * — no billing-specific error branching added here.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const input = createCheckoutSchema.parse(body);

    const billingService = await buildBillingService();
    const session = await billingService.createCheckoutSession(input);

    return NextResponse.json({ data: session }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}