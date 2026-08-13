// src/app/api/cases/[id]/assignments/[lawyerId]/remove/route.ts
//
// FOUNDATION TASK 2 — Case Assignment & Access Architecture.
//
// Thin Route Handler; all logic in CaseAccessGrantService#removeAssignment().
// Same POST-suffixed-action convention as /grants/[grantId]/revoke and
// /assignments/reassign — see those routes' own header comments.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseAccessGrantService } from '@/modules/cases/case.factory';

interface RouteContext {
  params: { id: string; lawyerId: string };
}

/**
 * POST /api/cases/[id]/assignments/[lawyerId]/remove
 * Removes a lawyer's assignment from a case (soft-revoke). Same
 * authorization gate as assignCase()/reassignCase(); 404s if the lawyer
 * has no active assignment on this case.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id, lawyerId } = context.params;
    const currentUser = await getCurrentUser();
    const grantService = await createCaseAccessGrantService(currentUser);

    const removed = await grantService.removeAssignment(id, lawyerId);

    return NextResponse.json({ data: removed });
  } catch (error) {
    return handleApiError(error);
  }
}
