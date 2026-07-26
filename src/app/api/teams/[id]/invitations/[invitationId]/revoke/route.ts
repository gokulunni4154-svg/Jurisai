// src/app/api/teams/[id]/invitations/[invitationId]/revoke/route.ts
// Phase 4 — Enterprise & Collaboration, Invitation System.
//
// RENAMED THIS SESSION, two changes together (same pattern as the
// firms/[id]/invitations/[invitationId]/revoke fix earlier this
// session):
//   1. Parent folder `[teamId]` -> `[id]`, matching teams/[id]/members
//      and the project-wide `[id]` convention.
//   2. This route's own `[id]` (the invitation's id) -> `[invitationId]`,
//      required together with (1) — leaving this segment as `[id]`
//      while the parent also became `[id]` would reproduce the same
//      "same slug name repeat" crash one level deeper.
// `context.params.id` (previously the invitation id) is now
// `context.params.invitationId`; `context.params.teamId` is now
// `context.params.id`.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createTeamInvitationService } from '@/modules/user-management/team-invitation.factory';

/**
 * POST /api/teams/[id]/invitations/[invitationId]/revoke
 *
 * Direct structural mirror of
 * /api/firms/[id]/invitations/[invitationId]/revoke/route.ts — same
 * POST-to-/revoke reasoning, same "the team `[id]` in the path is not
 * independently used by the service, which resolves the invitation's
 * own team_id (and from there, firm_id) from the row itself" note.
 */
export async function POST(
  _request: NextRequest,
  context: { params: { id: string; invitationId: string } },
): Promise<NextResponse> {
  try {
    const invitationId = context.params.invitationId;
    const currentUser = await getCurrentUser();

    const teamInvitationService = createTeamInvitationService(currentUser);
    await teamInvitationService.revokeInvitation(invitationId);

    return NextResponse.json({ data: { revoked: true } }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}