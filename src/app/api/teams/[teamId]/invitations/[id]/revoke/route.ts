// src/app/api/teams/[teamId]/invitations/[id]/revoke/route.ts
// Phase 4 — Enterprise & Collaboration, Invitation System.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createTeamInvitationService } from '@/modules/user-management/team-invitation.factory';

/**
 * POST /api/teams/[teamId]/invitations/[id]/revoke
 *
 * Direct structural mirror of
 * /api/firms/[firmId]/invitations/[id]/revoke/route.ts — same
 * POST-to-/revoke reasoning, same "teamId in the path is not
 * independently used by the service, which resolves the invitation's
 * own team_id (and from there, firm_id) from the row itself" note.
 */
export async function POST(
  request: NextRequest,
  context: { params: { teamId: string; id: string } },
): Promise<NextResponse> {
  try {
    const invitationId = context.params.id;
    const currentUser = await getCurrentUser();

    const teamInvitationService = createTeamInvitationService(currentUser);
    await teamInvitationService.revokeInvitation(invitationId);

    return NextResponse.json({ data: { revoked: true } }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}