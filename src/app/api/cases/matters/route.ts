// src/app/api/cases/matters/route.ts
//
// NEW, Matters Page (Lawyer Terminal Task 2). Self-scoped, no [id] --
// same "resolves entirely off the authenticated caller" shape as
// /api/cases/mine and /api/dashboard/lawyer, and the same reasoning:
// no firmId/organizationId/userId/role is ever read from the request,
// authorization is derived server-side from the session via
// getCurrentUser() + CaseService#listMatters()'s own
// requireAuthentication() + RLS.
//
// Nested under /api/cases (not a new top-level /api/matters) to sit
// next to the sibling GET/POST /api/cases route.ts this reuses the
// same CaseService/CaseRepository/factory for -- "matters" is this
// page's product name for the same `cases` resource, not a separate
// entity.
//
// Structural conventions followed, matching every other route in this
// project: getCurrentUser(), createCaseService(currentUser) from the
// existing factory (unmodified), handleApiError() wrapping, { data }
// envelope.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseService } from '@/modules/cases/case.factory';

/**
 * GET /api/cases/matters
 * Every case (matter) visible to the caller under RLS -- owned, an
 * active case_access_grants row, or firm owner/admin over their own
 * firm's cases (is_firm_case_manager()) -- with the linked client's
 * name flattened on where clients RLS permits the caller to read it.
 * See CaseService#listMatters() / CaseRepository#findManyVisibleWithClient()
 * for the exact visibility rules, including the real clients-RLS
 * caveat neither of those methods works around.
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();

    const caseService = await createCaseService(currentUser);
    const matters = await caseService.listMatters();

    return NextResponse.json({ data: matters }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
