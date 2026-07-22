// src/app/api/teams/[teamId]/invitations/route.ts
// Phase 4 — Enterprise & Collaboration, Invitation System.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createTeamInvitationService } from '@/modules/user-management/team-invitation.factory';

/**
 * POST /api/teams/[teamId]/invitations — create a team invitation.
 * GET  /api/teams/[teamId]/invitations — list all invitations (pending +
 *   historical) for this team.
 *
 * Direct structural mirror of /api/firms/[firmId]/invitations/route.ts,
 * with one real difference: body is `{ profileId }`, not
 * `{ email, role }` — team invitations have no email/token/role at all
 * (Decisions #11/#12), only an existing profile id. Decision #11's
 * "target must already be a firm member" precondition is enforced
 * inside TeamInvitationService#createInvitation() itself, not here —
 * same division of responsibility as every other route in this project.
 */
export async function POST(
  request: NextRequest,
  context: { params: { teamId: string } },
): Promise<NextResponse> {
  try {
    const teamId = context.params.teamId;
    const currentUser = await getCurrentUser();
    const body = await request.json();

    const profileId = body?.profileId;

    if (typeof profileId !== 'string' || profileId.trim().length === 0) {
      throw new ValidationError('profileId is required.', { received: profileId });
    }

    const teamInvitationService = createTeamInvitationService(currentUser);
    const result = await teamInvitationService.createInvitation({ teamId, profileId });

    return NextResponse.json({ data: result.invitation }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(
  request: NextRequest,
  context: { params: { teamId: string } },
): Promise<NextResponse> {
  try {
    const teamId = context.params.teamId;
    const currentUser = await getCurrentUser();

    const teamInvitationService = createTeamInvitationService(currentUser);
    const invitations = await teamInvitationService.listForTeam(teamId);

    return NextResponse.json({ data: invitations }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}