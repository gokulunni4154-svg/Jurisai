// src/app/api/teams/[id]/members/[profileId]/route.ts
//
// DRAFT — see cases/route.ts's header comment re: Source Verification
// Rule; this route additionally depends on TeamMemberService's real
// factory (team-member.factory.ts), which has not been pasted in this
// conversation either — only its constructor signature was described
// in the continuation prompt: (currentUser, teamRepository,
// teamMemberRepository, firmMemberRepository, auditLogRepository).
// Import path/name for its build function is a guess
// (buildTeamMemberService), not confirmed.
//
// Route shape (PATCH on the member sub-resource) mirrors "most likely"
// wording from the continuation prompt itself, describing this as
// analogous to FirmMemberService's own changeRole() route shape — not
// independently confirmed against a real teams route file.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/core/auth/get-auth-user';
import { handleApiError } from '@/core/errors/handle-api-error';
import { buildTeamMemberService } from '@/modules/user-management/team-member.factory';

interface RouteContext {
  params: { id: string; profileId: string };
}

/**
 * PATCH /api/teams/[id]/members/[profileId]
 * Changes a team member's role (member/lead) via
 * TeamMemberService#changeRole(). Owner/admin of the team's parent
 * firm only — gate lives entirely in the Service
 * (requireManageAccess()), not here. No last-lead protection (see
 * changeRole()'s own doc comment) — a team may reach zero leads.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id, profileId } = context.params;
    const currentUser = await getAuthUser(request);
    const teamMemberService = await buildTeamMemberService(currentUser);

    const body = await request.json();
    const { role } = body;

    const updated = await teamMemberService.changeRole(id, profileId, role);

    return NextResponse.json({ data: updated });
  } catch (error) {
    return handleApiError(error);
  }
}