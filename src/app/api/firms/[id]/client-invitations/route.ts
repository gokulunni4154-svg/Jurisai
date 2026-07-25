// src/app/api/firms/[id]/client-invitations/route.ts
// Client Management. Direct structural mirror of the CONFIRMED real
// src/app/api/firms/[firmId]/invitations/route.ts — same auth
// resolution (getCurrentUser() from @/core/auth/session, awaited,
// passed synchronously into the factory), same manual-validation-not-
// zod convention, same "authorization lives in the service, not here"
// division of responsibility.
//
// ROUTE SHAPE, JUDGMENT CALL: nested under /firms/[id]/, not
// /clients/[clientId]/ — chosen to match listForFirm(firmId)'s own
// requirement (GET needs firmId in the URL) and to keep this route at
// the same nesting depth as the firm-invitations route it mirrors. POST
// takes `clientId` in the BODY, not the URL, since
// ClientInvitationService#createInvitation() only needs clientId (it
// resolves firmId from the client row itself — see that method's own
// doc comment) — the `id` (firm id) path param is present for
// resource-shape consistency but not passed to the service call, same
// established pattern as team-members' nested routes ignoring `id` in
// favor of resolving firm_id from the row.
//
// FLAGGED: this file path/shape has NOT been independently confirmed
// against any real pasted route for client-invitations specifically —
// no such route exists yet in the project. Correct this if a different
// shape turns out to already exist or gets decided instead.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createClientInvitationService } from '@/modules/user-management/client-invitation.factory';

/**
 * POST /api/firms/[id]/client-invitations — create a client invitation.
 *
 * Body: { clientId: string }. No `email`/`role` fields, unlike the
 * firm-invitations POST body — see client-invitation.service.ts's own
 * doc comment for why neither has a client analog.
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();
    const body = await request.json();

    const clientId = body?.clientId;

    if (typeof clientId !== 'string' || clientId.trim().length === 0) {
      throw new ValidationError('clientId is required.', { received: clientId });
    }

    const clientInvitationService = createClientInvitationService(currentUser);
    const result = await clientInvitationService.createInvitation({ clientId });

    return NextResponse.json({ data: result.invitation, inviteUrl: result.inviteUrl }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/firms/[id]/client-invitations — list all client invitations
 * (pending + historical) for this firm.
 */
export async function GET(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;
    const currentUser = await getCurrentUser();

    const clientInvitationService = createClientInvitationService(currentUser);
    const invitations = await clientInvitationService.listForFirm(firmId);

    return NextResponse.json({ data: invitations }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}