// src/app/api/professional-verification/me/route.ts
// #43 — Professional account verification.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createProfessionalVerificationService } from '@/modules/professional-verification/professional-verification.factory';

/**
 * GET /api/professional-verification/me
 *
 * Returns the current user's own verification row, or `null` if they've
 * never submitted one. Authorization NOT handled here — same division
 * of responsibility as the confirmed `route.ts` convention:
 * `requireAuthentication()` lives inside
 * `ProfessionalVerificationService#getOwnVerification()` itself. An
 * unauthenticated caller gets a 401 via `handleApiError`, not a route-
 * layer check.
 *
 * RECONCILED THIS SESSION (open item #4): session now resolved here via
 * `getCurrentUser()` and passed into the factory, matching every other
 * route in the project (Pattern 1) instead of the factory resolving it
 * internally. The factory itself is still `await`ed — see its own doc
 * comment for why that's unrelated to this change.
 *
 * No maxDuration override — a single DB read, same reasoning the
 * confirmed `route.ts` gives for omitting it on pure-DB-read paths.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();

    const service = await createProfessionalVerificationService(currentUser);

    const verification = await service.getOwnVerification();

    return NextResponse.json({ data: verification }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/professional-verification/me
 *
 * Submits a new verification (first time) or resubmits after rejection.
 * All transition-rule enforcement ("resubmit only from rejected") lives
 * inside `ProfessionalVerificationService#submit()` — this route only
 * parses the request body.
 *
 * Body-shape validation: no existing route in this project's confirmed
 * source had an established convention for validating a JSON body when
 * this route was first built, so this was a new, flagged choice: read
 * `registrationNumber` from the body, and if it's missing or not a
 * non-empty string, reject before calling the Service.
 *
 * RESOLVED, CLOSED (prior session): this validation failure previously
 * threw a plain `Error`. `core/errors/app-error.ts` and
 * `core/errors/error-handler.ts` are now confirmed real via full pasted
 * source. Per `error-handler.ts`'s `normalizeError()`, a plain `Error`
 * is wrapped in `InternalServerError` (HTTP 500) — so this validation
 * failure was silently surfacing as a fake server error instead of a
 * 400. Now throws `ValidationError` (HTTP 400, `VALIDATION_FAILED`),
 * matching `error-handler.ts`'s own `ZodError` handling for the same
 * class of failure. `submit()`'s transition-rule error is fixed
 * separately, in `professional-verification.service.ts` (now throws
 * `ConflictError`, HTTP 409) — that fix does not require any change
 * here, since this route already just re-throws whatever the Service
 * throws up to `handleApiError`.
 *
 * RECONCILED THIS SESSION (open item #4): same session-resolution
 * change as GET above.
 *
 * No maxDuration override — same reasoning as GET above.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    const registrationNumber = body?.registrationNumber;

    if (typeof registrationNumber !== 'string' || registrationNumber.trim().length === 0) {
      throw new ValidationError(
        'registrationNumber is required and must be a non-empty string.',
        { received: registrationNumber },
      );
    }

    const currentUser = await getCurrentUser();

    const service = await createProfessionalVerificationService(currentUser);

    const verification = await service.submit(registrationNumber.trim());

    return NextResponse.json({ data: verification }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}