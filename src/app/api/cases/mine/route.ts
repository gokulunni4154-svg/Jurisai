// src/app/api/cases/mine/route.ts
//
// NEW THIS SESSION. Path/shape NOT mirrored from confirmed real
// precedent -- every other route pasted so far in this project is
// nested under /api/firms/[id]/..., but this endpoint is inherently
// self-scoped (CaseAccessGrantService#listMyCases() takes no params,
// resolves entirely off the authenticated caller via
// requireAuthentication()). No firmId in the path because none is
// needed or used. Flagging this as this session's own design judgment,
// same as client-invitations/route.ts was flagged last session --
// correct the path if a different shape already exists elsewhere or is
// preferred.
//
// Structural conventions that ARE confirmed and followed: getCurrentUser()
// import path, handleApiError() wrapping, "authorization lives in the
// service, not here" division of responsibility (listMyCases() needs
// none beyond authentication, enforced inside the service via
// requireAuthentication()).

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseAccessGrantService } from '@/modules/cases/case.factory';

/**
 * GET /api/cases/mine — every case the CURRENT authenticated user has
 * an active case_access_grants row for. Built for the client-portal
 * "My Cases" view (see this session's RLS-scoping finding: grantee_id
 * carries no role distinction, so this works identically for a linked
 * client profile or firm staff with a grant on a case they don't own).
 *
 * No :id / firmId param — self-scoped by design, see file header.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();

    const caseAccessGrantService = await createCaseAccessGrantService(currentUser);
    const cases = await caseAccessGrantService.listMyCases();

    return NextResponse.json({ data: cases }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}