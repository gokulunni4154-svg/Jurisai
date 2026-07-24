// src/app/api/firms/[id]/teams/[teamId]/members/[profileId]/route.ts
// Phase 4 — Enterprise & Collaboration, Teams/departments sub-feature.
// Change role (PATCH) / remove (DELETE) a team member.
//
// CORRECTED, Open Item #70: previously drafted at a flat
// /api/teams/[id]/members/[profileId] path, mirroring the firm-member
// route's top-level shape. That was wrong — the real, pasted
// app/api/firms/[id]/teams/[teamId]/members/route.ts (POST/GET)
// confirms team-member routes nest under the firm, one level below
// teams. Moved here to match. `id` (firm id) is present in the URL for
// resource-shape consistency, same as the sibling POST/GET route, but
// not separately passed to the service call — TeamMemberService itself
// resolves the team's real firm_id via TeamRepository, never from
// caller input (same authorization-bypass reasoning
// team-invitation.service.ts's class doc comment gives for the
// identical pattern).

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createTeamMemberService } from '@/modules/user-management/team-member.factory';
import { getCurrentUser } from '@/core/auth/session';
import type { Database } from '@/core/supabase/database.types';

type TeamMemberRole = Database['public']['Tables']['team_members']['Row']['role'];
const TEAM_MEMBER_ROLE_VALUES: readonly TeamMemberRole[] = ['member', 'lead'];

/**
 * PATCH /api/firms/[id]/teams/[teamId]/members/[profileId]
 *
 * Changes a team member's role (member/lead). Authorization lives
 * inside TeamMemberService#changeRole() via requireManageAccess() —
 * firm owner/admin of the team's parent firm only, not team-lead-gated.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: { id: string; teamId: string; profileId: string } },
): Promise<NextResponse> {
  try {
    const teamId = context.params.teamId;
    const targetProfileId = context.params.profileId;
    const body = await request.json();
    const newRole = body?.role;

    if (typeof newRole !== 'string' || !TEAM_MEMBER_ROLE_VALUES.includes(newRole as TeamMemberRole)) {
      throw new ValidationError(
        `role is required and must be one of: ${TEAM_MEMBER_ROLE_VALUES.join(', ')}.`,
        { received: newRole },
      );
    }

    const currentUser = await getCurrentUser();
    const service = createTeamMemberService(currentUser);
    const updated = await service.changeRole(teamId, targetProfileId, newRole as TeamMemberRole);

    return NextResponse.json({ data: updated }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/firms/[id]/teams/[teamId]/members/[profileId]
 *
 * Removes a profile from a team. Same requireManageAccess() gate as
 * PATCH. Void-returning — bare 204, no JSON envelope, matching this
 * project's confirmed convention (app/api/firms/[id]/members/[profileId]/route.ts's
 * real DELETE handler).
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