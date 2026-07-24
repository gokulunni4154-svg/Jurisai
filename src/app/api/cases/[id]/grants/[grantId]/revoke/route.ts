// src/app/api/cases/[id]/grants/[grantId]/revoke/route.ts
//
// DRAFT — see cases/route.ts's header comment re: Source Verification
// Rule. Same caveats apply.
//
// NOT CONFIRMED AGAINST REAL PRECEDENT: the continuation prompt states
// this project isn't fully consistent on PATCH-vs-POST-suffixed for a
// state-transition-style update (citing the ban-route vs.
// professional-verification-route history as the unresolved tension).
// This route picks a POST-suffixed action (/revoke) rather than a
// generic PATCH on the grant resource, on the reasoning that revocation
// is a soft-delete via revoked_at (an audit-preserving state
// transition), not a general field update — matching this project's
// case_access_grants design intent more than its route-naming history.
// This is a judgment call, not a confirmed convention — reconcile
// against the real ban-route / professional-verification-route files
// before treating this as settled.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseService } from '@/modules/cases/case.factory';

interface RouteContext {
  params: { id: string; grantId: string };
}

/**
 * POST /api/cases/[id]/grants/[grantId]/revoke
 * Soft-revokes a grant (sets revoked_at), per
 * CaseAccessGrantService#revokeGrant(). Same team-lead-or-firm-admin
 * gate as issueGrant() — enforced at the service layer, since
 * case_access_grants has no client-writable RLS policy at all.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id, grantId } = context.params;
   const currentUser = await getCurrentUser();               // ✅ new
const caseService = await createCaseService(currentUser);
    const revoked = await grantService.revokeGrant(id, grantId);

    return NextResponse.json({ data: revoked });
  } catch (error) {
    return handleApiError(error);
  }
}