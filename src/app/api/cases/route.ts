// src/app/api/cases/route.ts
//
// DRAFT — built from CASE_ACCESS_GRANTS_SCOPING.md / the continuation
// prompt's SUMMARY of case.service.ts and case.factory.ts, not from
// real pasted source for either file. Per the Source Verification Rule,
// confirm buildCaseService()'s real signature and CaseService's real
// method names/params before merging. Import paths below are best
// guesses at this project's module layout, not confirmed.
//
// Conventions applied, per the continuation prompt's description of
// what's already real in this project:
//   - Thin Route Handler; all logic in the Service.
//   - handleApiError() is the majority error-handling pattern.
//   - context.params.id destructured directly, no `await` (Next
//     14.2.35, not Next 15's Promise-wrapped params).

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseService } from '@/modules/cases/case.factory'; // 

/**
 * GET /api/cases
 * Lists cases visible to the caller (owner, active grantee, or firm
 * admin — per CaseService#listCases()'s RLS-backed scoping).
 */
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getAuthUser(request);
    const caseService = await buildCaseService(currentUser);

    const { searchParams } = new URL(request.url);
    const firmId = searchParams.get('firmId') ?? undefined;
    const teamId = searchParams.get('teamId') ?? undefined;

    const cases = await caseService.listCases({ firmId, teamId });

    return NextResponse.json({ data: cases });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/cases
 * Creates a case. Gated by CaseService's own requireCaseCreateAccess()
 * (team lead of teamId if given, else firm admin/owner of firmId) —
 * FLAGGED per the continuation prompt: a solo case owner who is not
 * also a firm admin currently cannot create/grant on their own case.
 * Not fixed here — carried forward as-is.
 */
export async function POST(request: NextRequest) {
  try {
    
const currentUser = await getCurrentUser();               // ✅ new
const caseService = await createCaseService(currentUser); // ✅ new

    const body = await request.json();
    const { firmId, teamId, title, status } = body;

    const newCase = await caseService.createCase({
      firmId,
      teamId,
      title,
      status,
    });

    return NextResponse.json({ data: newCase }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}