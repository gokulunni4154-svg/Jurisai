// src/app/api/firms/[id]/invitations/[invitationId]/revoke/route.ts
// Phase 4 — Enterprise & Collaboration, Invitation System.
//
// RENAMED THIS SESSION, two changes together (Open Item #85 resolution):
//   1. Parent folder `[firmId]` -> `[id]`, matching the other firms/[id]/...
//      subtrees (clients, members, teams, reports, tasks).
//   2. This route's own `[id]` (the invitation's id) -> `[invitationId]`,
//      matching the `client-invitations/[invitationId]` naming convention
//      already used elsewhere in this project.
// Both changes were required together, not independently — renaming only
// the parent to `[id]` while this segment stayed `[id]` would have
// produced the exact same "same slug name repeat" crash one level deeper.
// `context.params.id` (previously the invitation id) is now
// `context.params.invitationId`; `context.params.firmId` is now
// `context.params.id`. firmId/the new `id` param is still not passed into
// revokeInvitation() — same reasoning as before, unchanged by this rename.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createFirmInvitationService } from '@/modules/user-management/firm-invitation.factory';

/**
 * POST /api/firms/[id]/invitations/[invitationId]/revoke
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
 * The firm `[id]` in the path is not independently used by
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
  _request: NextRequest,
  context: { params: { id: string; invitationId: string } },
): Promise<NextResponse> {
  try {
    const invitationId = context.params.invitationId;
    const currentUser = await getCurrentUser();

    const firmInvitationService = createFirmInvitationService(currentUser);
    await firmInvitationService.revokeInvitation(invitationId);

    return NextResponse.json({ data: { revoked: true } }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}