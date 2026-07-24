// src/app/api/cases/[id]/route.ts
//
// DRAFT — see cases/route.ts's header comment re: Source Verification
// Rule. Same caveats apply.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseService } from '@/modules/cases/case.factory'; // or createCaseAccessGrantService

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/cases/[id]
 * Fetches a single case. RLS/CaseService#getCaseById() handles the
 * owner/grantee/firm-admin visibility check; a caller with none of
 * those surfaces as NotFoundError, not a distinct 403 — matching this
 * project's existing pattern of not leaking existence to unauthorized
 * callers (same posture as documents/document_sets).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();               // ✅ new
const caseService = await createCaseService(currentUser); // ✅ new

    const caseRecord = await caseService.getCaseById(id);

    return NextResponse.json({ data: caseRecord });
  } catch (error) {
    return handleApiError(error);
  }
}