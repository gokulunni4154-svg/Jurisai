// src/app/api/professional-verification/admin/[id]/review/route.ts
// #43 — Professional account verification, admin decision route.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createProfessionalVerificationService } from '@/modules/professional-verification/professional-verification.factory';
import type { VerificationStatus } from '@/modules/professional-verification/professional-verification.repository';

const DECISION_VALUES: readonly Extract<VerificationStatus, 'verified' | 'rejected'>[] = [
  'verified',
  'rejected',
];

/**
 * POST /api/professional-verification/admin/[id]/review
 *
 * Admin approve/reject decision on a single verification row.
 * Authorization NOT handled here — `requireRole('admin')` lives inside
 * `ProfessionalVerificationService#review()` itself, same division of
 * responsibility as every other route in this module.
 *
 * RECONCILED THIS SESSION (open item #4): session now resolved here via
 * `getCurrentUser()` and passed into the factory (Pattern 1), instead of
 * the factory resolving it internally. Authorization itself is
 * unchanged -- `requireRole('admin')` still runs inside the Service.
 *
 * FLAGGED, JUDGMENT CALL (carried forward, unrelated to this session's
 * change): **method is POST**, not PATCH. Chosen for consistency with
 * `me/route.ts`'s POST-for-a-state-transition convention (submit/
 * resubmit is also POST, not PATCH, on that route) rather than treating
 * this as a REST-style partial update. If the real project convention
 * elsewhere uses PATCH for single-resource state changes, this should
 * change to match — no such precedent has been pasted and confirmed
 * either way.
 *
 * FLAGGED, JUDGMENT CALL (carried forward): **body shape** is
 * `{ decision: 'verified' | 'rejected' }`. `decision` is validated
 * against the real `Extract<VerificationStatus, 'verified' | 'rejected'>`
 * type `ProfessionalVerificationService#review()` actually accepts —
 * anything else throws `ValidationError` (400) before the Service is
 * ever called.
 *
 * Route param: `id` is the verification row's id (NOT the profile id or
 * the reviewing admin's id) — matches `review(verificationId, decision)`'s
 * first parameter, confirmed via `professional-verification.service.ts`.
 *
 * Next.js route param handling (RESOLVED THIS SESSION, item #5):
 * `package.json` confirms `next: 14.2.35`. Next.js 14 does not
 * Promise-wrap dynamic route params -- that change (`params` becoming a
 * `Promise`, requiring `await context.params`) landed in Next.js 15.
 * So `context.params` being destructured directly here, unawaited, is
 * correct as written, not a latent bug. This also means the standing
 * `PATCH /api/notifications/[id]/read` bug is NOT a Promise-wrapping
 * issue after all -- whatever's actually wrong there is something else,
 * worth a fresh look next time that route comes up.
 *
 * No maxDuration override — a single existing-row read plus a single
 * update, same reasoning used throughout this module.
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const verificationId = context.params.id;

    const body = await request.json();

    const decision = body?.decision;

    if (
      typeof decision !== 'string' ||
      !DECISION_VALUES.includes(decision as (typeof DECISION_VALUES)[number])
    ) {
      throw new ValidationError(
        `decision is required and must be one of: ${DECISION_VALUES.join(', ')}.`,
        { received: decision },
      );
    }

    const currentUser = await getCurrentUser();

    const service = await createProfessionalVerificationService(currentUser);

    const verification = await service.review(
      verificationId,
      decision as (typeof DECISION_VALUES)[number],
    );

    return NextResponse.json({ data: verification }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}