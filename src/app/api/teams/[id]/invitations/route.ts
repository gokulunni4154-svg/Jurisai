// src/app/api/teams/[id]/invitations/route.ts
// Phase 4 — Enterprise & Collaboration, Invitation System.
//
// RENAMED THIS SESSION: folder was `[teamId]`, now `[id]` — same fix
// applied to firms/[firmId] -> firms/[id] earlier this session, for the
// same reason (Next.js "same slug name repeat" crash caused by two
// different dynamic-segment names, `[id]` and `[teamId]`, existing as
// siblings under teams/). `[id]` kept over `[teamId]` since it's the
// dominant convention across this whole project (cases/[id],
// documents/[id], hearings/[id], notes/[id], profiles/[id], tasks/[id],
// and teams/[id]/members already existed). All
// `context.params.teamId` references below updated to
// `context.params.id`.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createTeamInvitationService } from '@/modules/user-management/team-invitation.factory';

/**
 * POST /api/teams/[id]/invitations — create a team invitation.
 * GET  /api/teams/[id]/invitations — list all invitations (pending +
 *   historical) for this team.
 *
 * Direct structural mirror of /api/firms/[id]/invitations/route.ts,
 * with one real difference: body is `{ profileId }`, not
 * `{ email, role }` — team invitations have no email/token/role at all
 * (Decisions #11/#12), only an existing profile id. Decision #11's
 * "target must already be a firm member" precondition is enforced
 * inside TeamInvitationService#createInvitation() itself, not here —
 * same division of responsibility as every other route in this project.
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const teamId = context.params.id;
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
  _request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const teamId = context.params.id;
    const currentUser = await getCurrentUser();

    const teamInvitationService = createTeamInvitationService(currentUser);
    const invitations = await teamInvitationService.listForTeam(teamId);

    return NextResponse.json({ data: invitations }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}