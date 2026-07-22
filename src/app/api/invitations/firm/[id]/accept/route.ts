// src/app/api/invitations/firm/[id]/accept/route.ts
// Phase 4 — Enterprise & Collaboration, Invitation System.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createFirmInvitationService } from '@/modules/user-management/firm-invitation.factory';

/**
 * POST /api/invitations/firm/[id]/accept
 *
 * IN-APP PENDING-LIST acceptance path only (Decision #3's second
 * mechanism) — the TOKEN-LINK path for new-user invites has no route at
 * all, since Decision #13 puts that logic inside AuthService.signUp()
 * directly, not a separate endpoint. This route requires an
 * already-authenticated caller (getCurrentUser()), which a brand-new
 * sign-up by definition is not yet — consistent with
 * FirmInvitationService#acceptFromList()'s own doc comment.
 *
 * Separate from /api/invitations/team/[id]/accept for the same reason
 * the pending-list endpoints are split: firm_invitations and
 * team_invitations are different tables with different id spaces — a
 * single generic /api/invitations/[id]/accept route has no way to know
 * which service to call without querying both tables first.
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const invitationId = context.params.id;
    const currentUser = await getCurrentUser();

    const firmInvitationService = createFirmInvitationService(currentUser);
    await firmInvitationService.acceptFromList(invitationId);

    return NextResponse.json({ data: { accepted: true } }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}