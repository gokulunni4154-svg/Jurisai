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
 * FLAGGED / FIXED — session 55 (tsc pass): CreateCheckoutSessionInput
 * requires a `returnUrl: string` that createCheckoutSchema does not
 * validate (deliberately — see billing.schemas.ts). User confirmed this
 * session: returnUrl is SERVER-COMPUTED, not client-supplied — avoids
 * the open-redirect surface a client-controlled redirect target would
 * introduce, and the client never needed control over it in the first
 * place.
 *
 * Built from `request.nextUrl.origin` (the actual scheme+host the
 * request arrived on — correct in both local dev and every deployed
 * environment without needing a separate base-URL env var) plus a
 * fixed success-page path.
 *
 * FLAGGED, UNCONFIRMED: the path itself, '/billing/success', is a
 * placeholder — no real frontend route for a post-checkout success
 * page has been pasted or confirmed this session. Swap this string for
 * the real page path once it's confirmed; nothing else about this fix
 * depends on the exact path chosen.
 */
const CHECKOUT_SUCCESS_PATH = '/billing/success';

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
    const parsed = createCheckoutSchema.parse(body);

    // FLAGGED / FIXED — see this file's CHECKOUT_SUCCESS_PATH comment
    // above: returnUrl is computed here, server-side, never taken from
    // the client.
    const returnUrl = new URL(CHECKOUT_SUCCESS_PATH, request.nextUrl.origin).toString();
    const input = { ...parsed, returnUrl };

    const billingService = await buildBillingService();
    const session = await billingService.createCheckoutSession(input);

    return NextResponse.json({ data: session }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}