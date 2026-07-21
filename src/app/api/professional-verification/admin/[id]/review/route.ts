// src/app/api/professional-verification/admin/[id]/review/route.ts
// #43 — Professional account verification, admin decision route.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildProfessionalVerificationService } from '@/modules/professional-verification/professional-verification.factory';
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
 * FLAGGED, JUDGMENT CALL (not explicitly confirmed): **method is POST**,
 * not PATCH. Chosen for consistency with `me/route.ts`'s POST-for-a-
 * state-transition convention (submit/resubmit is also POST, not PATCH,
 * on that route) rather than treating this as a REST-style partial
 * update. If the real project convention elsewhere uses PATCH for
 * single-resource state changes, this should change to match — no such
 * precedent has been pasted and confirmed in this session either way.
 *
 * FLAGGED, JUDGMENT CALL (not explicitly confirmed): **body shape** is
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
 * Next.js 14 route param handling: this project's confirmed convention
 * elsewhere has at least one prior params-related bug (PATCH
 * /api/notifications/[id]/read's Promise-wrapped params issue, still
 * open/unconfirmed-fixed) — `context.params` is destructured directly
 * here (NOT awaited) since no pasted-and-confirmed source this session
 * shows whether this specific Next.js version wraps route params in a
 * Promise for dynamic API routes. Flagged: if this doesn't compile or
 * `params` comes back as a Promise, that prior bug is the first thing
 * to check.
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

    const service = await buildProfessionalVerificationService();

    const verification = await service.review(
      verificationId,
      decision as (typeof DECISION_VALUES)[number],
    );

    return NextResponse.json({ data: verification }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}