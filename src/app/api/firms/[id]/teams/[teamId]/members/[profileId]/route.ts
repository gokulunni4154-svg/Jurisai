// src/app/api/firms/[id]/teams/[teamId]/members/[profileId]/route.ts
// Phase 4 — Enterprise & Collaboration, Teams/departments sub-feature.
// Remove team member (DELETE).
//
// No PATCH handler here, unlike the firm-members equivalent at this
// same nesting depth: team_members has no role column to change
// (decision #4) — there is nothing for a PATCH to update. This is a
// structural consequence of the migration's own decision, not an
// independent omission.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { createTeamMemberService } from '@/modules/user-management/team-member.factory';
import { getCurrentUser } from '@/core/auth/session';

/**
 * DELETE /api/firms/[id]/teams/[teamId]/members/[profileId]
 *
 * Removes a member from the team. Authorization NOT handled here —
 * requireFirmRole(['owner','admin']) on the team's PARENT FIRM lives
 * inside TeamMemberService#removeMember() via requireManageAccess().
 * No last-owner-style protection exists (teams have no role, decision
 * #4 — that protection was specifically about roles).
 *
 * Route params: `teamId` and `profileId` — match
 * removeMember(teamId, targetProfileId)'s parameter order.
 *
 * Void return — CONFIRMED precedent this session via
 * document-sets/[id]/members/[documentId]/route.ts and the firm-members
 * DELETE route: a bare 204 No Content, not a JSON envelope.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: { id: string; teamId: string; profileId: string } },
): Promise<NextResponse> {
  try {
    const teamId = context.params.teamId;
    const targetProfileId = context.params.profileId;

    const currentUser = await getCurrentUser();
    const service = createTeamMemberService(currentUser);
    await service.removeMember(teamId, targetProfileId);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}