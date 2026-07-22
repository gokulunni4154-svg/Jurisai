// src/app/api/invitations/team/[id]/accept/route.ts
// Phase 4 — Enterprise & Collaboration, Invitation System.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createTeamInvitationService } from '@/modules/user-management/team-invitation.factory';

/**
 * POST /api/invitations/team/[id]/accept
 *
 * Direct structural mirror of /api/invitations/firm/[id]/accept/route.ts.
 * Unlike the firm version, this is the ONLY acceptance path team
 * invitations have at all (Decision #12) — there's no token-link
 * counterpart to note as absent, because none was ever possible for
 * teams in the first place.
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const invitationId = context.params.id;
    const currentUser = await getCurrentUser();

    const teamInvitationService = createTeamInvitationService(currentUser);
    await teamInvitationService.acceptInvitation(invitationId);

    return NextResponse.json({ data: { accepted: true } }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}