// src/app/api/cases/[id]/assignments/reassign/route.ts
//
// FOUNDATION TASK 2 — Case Assignment & Access Architecture.
//
// Thin Route Handler; all logic in CaseAccessGrantService#reassignCase().
// POST-suffixed action (not a generic PATCH on the resource), matching
// the existing precedent set by /grants/[grantId]/revoke — see that
// route's own header comment for the reasoning this project follows for
// state-transition-style updates.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseAccessGrantService } from '@/modules/cases/case.factory';

interface RouteContext {
  params: { id: string };
}

/**
 * POST /api/cases/[id]/assignments/reassign
 * Reassigns a case from one lawyer to another. Body:
 * { fromLawyerId: string, toLawyerId: string, accessLevel?: 'read' | 'read_write' }.
 *
 * Same authorization and same-firm validation as
 * POST /api/cases/[id]/assignments (assignCase), applied to toLawyerId.
 * A missing prior assignment for fromLawyerId is not an error — see
 * CaseAccessGrantService#reassignCase()'s own doc comment.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const grantService = await createCaseAccessGrantService(currentUser);

    const body = await request.json();
    const { fromLawyerId, toLawyerId, accessLevel } = body;

    const grant = await grantService.reassignCase({
      caseId: id,
      fromLawyerId,
      toLawyerId,
      accessLevel,
    });

    return NextResponse.json({ data: grant });
  } catch (error) {
    return handleApiError(error);
  }
}
