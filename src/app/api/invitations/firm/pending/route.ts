// src/app/api/invitations/firm/pending/route.ts
// Phase 4 — Enterprise & Collaboration, Invitation System.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createFirmInvitationService } from '@/modules/user-management/firm-invitation.factory';

/**
 * GET /api/invitations/firm/pending
 *
 * The in-app pending-list read path (Decision #3) for firm invitations.
 * Deliberately a separate endpoint from /api/invitations/team/pending
 * rather than one combined one — decided explicitly this session:
 * firm_invitations and team_invitations are structurally different row
 * shapes (role/email/token vs. neither), matching the two-table split
 * (Decision #6) and the two-service split this project has kept
 * consistent end to end. A combined endpoint would have to merge those
 * two shapes into one response, working against that separation instead
 * of following it.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();

    const firmInvitationService = createFirmInvitationService(currentUser);
    const invitations = await firmInvitationService.listPendingForCurrentUser();

    return NextResponse.json({ data: invitations }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}