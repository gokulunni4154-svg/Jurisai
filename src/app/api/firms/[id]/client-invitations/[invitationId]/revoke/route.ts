// src/app/api/firms/[id]/client-invitations/[invitationId]/revoke/route.ts
// Client Management. Direct structural mirror of the CONFIRMED real
// src/app/api/firms/[firmId]/invitations/[id]/revoke/route.ts — same
// POST-to-/revoke-suffix reasoning (status transition, not row
// deletion — the row persists for the audit trail), same
// "firmId in the path isn't independently used by the service"
// pattern (revokeInvitation() resolves the invitation's own firm_id
// from the row itself).

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createClientInvitationService } from '@/modules/user-management/client-invitation.factory';

/**
 * POST /api/firms/[id]/client-invitations/[invitationId]/revoke
 */
export async function POST(
  _request: NextRequest,
  context: { params: { id: string; invitationId: string } },
): Promise<NextResponse> {
  try {
    const invitationId = context.params.invitationId;
    const currentUser = await getCurrentUser();

    const clientInvitationService = createClientInvitationService(currentUser);
    await clientInvitationService.revokeInvitation(invitationId);

    return NextResponse.json({ data: { revoked: true } }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}