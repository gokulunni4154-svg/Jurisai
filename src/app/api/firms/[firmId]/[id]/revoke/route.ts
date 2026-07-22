// src/app/api/firms/[firmId]/invitations/[id]/revoke/route.ts
// Phase 4 — Enterprise & Collaboration, Invitation System.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createFirmInvitationService } from '@/modules/user-management/firm-invitation.factory';

/**
 * POST /api/firms/[firmId]/invitations/[id]/revoke
 *
 * FLAGGED, JUDGMENT CALL: POST to a /revoke sub-route, not DELETE on the
 * invitation's own URL — decided explicitly this session (not guessed):
 * DELETE would misleadingly imply the row is removed, when revoking
 * only transitions status -> 'revoked' and the row persists for the
 * audit trail (Decision #9). Matches this project's own established
 * verb-suffixed-route convention for state transitions (PATCH
 * /api/notifications/[id]/read, POST
 * /api/professional-verification/admin/[id]/review) — action-as-URL,
 * not HTTP-method-as-semantics.
 *
 * `firmId` in the path is not independently used by
 * FirmInvitationService#revokeInvitation() (it resolves the invitation's
 * own firm_id from the row itself, same authorization-safety reasoning
 * TeamInvitationService's methods use) — included in the URL purely for
 * REST-shape consistency with the sibling create/list route, not because
 * the service needs it as an argument.
 *
 * Next.js route param handling: `context.params` destructured directly,
 * NOT awaited — same unconfirmed-either-way convention the pasted
 * Professional Verification review route already uses. Flagged: if this
 * doesn't compile or params comes back as a Promise, this is the same
 * open item as that file's own flag.
 */
export async function POST(
  request: NextRequest,
  context: { params: { firmId: string; id: string } },
): Promise<NextResponse> {
  try {
    const invitationId = context.params.id;
    const currentUser = await getCurrentUser();

    const firmInvitationService = createFirmInvitationService(currentUser);
    await firmInvitationService.revokeInvitation(invitationId);

    return NextResponse.json({ data: { revoked: true } }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}