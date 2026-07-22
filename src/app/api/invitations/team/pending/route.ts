// src/app/api/invitations/team/pending/route.ts
// Phase 4 — Enterprise & Collaboration, Invitation System.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createTeamInvitationService } from '@/modules/user-management/team-invitation.factory';

/**
 * GET /api/invitations/team/pending
 *
 * Direct structural mirror of /api/invitations/firm/pending/route.ts —
 * same reasoning for why this is a separate endpoint rather than
 * combined. This is also the ONLY acceptance-adjacent read path a team
 * invitation ever has (Decision #12: no token/new-user path exists for
 * teams at all).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();

    const teamInvitationService = createTeamInvitationService(currentUser);
    const invitations = await teamInvitationService.listPendingForCurrentUser();

    return NextResponse.json({ data: invitations }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}