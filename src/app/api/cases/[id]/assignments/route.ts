// src/app/api/cases/[id]/assignments/route.ts
//
// FOUNDATION TASK 2 — Case Assignment & Access Architecture.
//
// Thin Route Handler; all logic (including the same-firm validation) in
// CaseAccessGrantService#assignCase(). Distinct from the pre-existing
// POST /api/cases/[id]/grants route: that route (case-access-grant.service.ts's
// issueGrant()) is the general-purpose grant primitive, unrestricted on
// grantee type (also used for client access grants). This route is the
// lawyer-assignment-specific entry point — same authorization gate
// (case owner / team lead / firm admin), plus the firm-membership check
// on the target lawyer that issueGrant() deliberately does not enforce.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseAccessGrantService } from '@/modules/cases/case.factory';

interface RouteContext {
  params: { id: string };
}

/**
 * POST /api/cases/[id]/assignments
 * Assigns a case to a lawyer. Body: { lawyerId: string, accessLevel?: 'read' | 'read_write' }.
 *
 * Authorization: case owner, team lead of the case's team, or firm
 * admin/owner (CaseAccessGrantService#requireGrantManageAccess).
 * Additionally requires lawyerId to be a firm_members row of the case's
 * own firm — CASE ACCESS TEST 8 (cross-firm assignment is rejected).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const grantService = await createCaseAccessGrantService(currentUser);

    const body = await request.json();
    const { lawyerId, accessLevel } = body;

    const grant = await grantService.assignCase({
      caseId: id,
      lawyerId,
      accessLevel,
    });

    return NextResponse.json({ data: grant }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
