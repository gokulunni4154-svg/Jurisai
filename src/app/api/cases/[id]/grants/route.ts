// src/app/api/cases/[id]/grants/route.ts
//
// DRAFT — see cases/route.ts's header comment re: Source Verification
// Rule. Same caveats apply; buildCaseAccessGrantService()'s real
// signature is unconfirmed.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseService } from '@/modules/cases/case.factory';

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/cases/[id]/grants
 * Lists active + revoked grants for a case. Visibility per
 * CaseAccessGrantService/RLS: the grantee (own grants), case owner,
 * granter, or firm admin.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    
const currentUser = await getCurrentUser();               // ✅ new
const caseService = await createCaseService(currentUser); // ✅ new

    const grants = await grantService.listGrantsForCase(id);

    return NextResponse.json({ data: grants });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/cases/[id]/grants
 * Issues a new access grant on a case.
 *
 * FLAGGED, carried forward from the continuation prompt: gated to
 * team-lead-or-firm-admin only, per the confirmed decision's literal
 * wording ("team heads and firm admins"). A solo case owner who is not
 * also a firm admin cannot grant access to their own case — a real,
 * possibly-unintended consequence, not fixed here.
 *
 * Also flagged: issueGrant does not validate that granteeId is an
 * actual member of the case's firm/team before granting — mirrors
 * document_set_members' own precedent of leaving that unenforced.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getAuthUser(request);
    const grantService = await buildCaseAccessGrantService(currentUser);

    const body = await request.json();
    const { granteeId, accessLevel } = body;

    const grant = await grantService.issueGrant(id, granteeId, accessLevel);

    return NextResponse.json({ data: grant }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}