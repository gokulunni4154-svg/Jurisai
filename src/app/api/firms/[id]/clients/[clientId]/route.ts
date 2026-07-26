// src/app/api/firms/[id]/clients/[clientId]/route.ts
// Client Management. Structural mirror of the real, pasted
// src/app/api/firms/[id]/clients/route.ts -- same getCurrentUser()
// import path, same manual-validation-not-zod convention, same
// "authorization lives in the service, not here" division of
// responsibility, same Next.js params-not-Promise-wrapped handling.
//
// This file is the missing HTTP layer for two ClientService methods
// that already exist and are already fully authorized --
// getClient(clientId) and updateClient(clientId, input) -- but were
// unreachable from outside the module before this file existed. Same
// situation Lawyer Inquiry's assign/convert routes were in relative to
// assignInquiry()/convertInquiry() last session.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createClientService } from '@/modules/user-management/client.factory';

/**
 * GET /api/firms/[id]/clients/[clientId] — fetch a single client
 * record.
 *
 * Authorization NOT handled here — ClientService#getClient()'s own
 * requireFirmRole(['owner','admin']) call handles it, scoped off the
 * client row's own firm_id (not off this route's [id] param — see
 * FLAGGED note below).
 *
 * FLAGGED, not fixed: this route's [id] (firm id) path segment is
 * never read or checked against the client's actual firm_id.
 * getClient() resolves the firm entirely from the client row itself,
 * so a request to the "wrong" firm's URL for a real clientId the
 * caller is otherwise authorized for will still succeed. Not a real
 * authorization gap (requireFirmRole() still correctly scopes to the
 * client's real firm), but the URL's own [id] segment is decorative
 * here rather than enforced — same category of thing convert/route.ts's
 * own header flagged for its ignored teamId field. Left as-is rather
 * than adding an unrequested firmId-mismatch check with no confirmed
 * product decision behind it.
 */
export async function GET(
  _request: NextRequest,
  context: { params: { id: string; clientId: string } },
): Promise<NextResponse> {
  try {
    const { clientId } = context.params;
    const currentUser = await getCurrentUser();

    const clientService = createClientService(currentUser);
    const client = await clientService.getClient(clientId);

    return NextResponse.json({ data: client }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/firms/[id]/clients/[clientId] — update a client record.
 *
 * Authorization NOT handled here — ClientService#updateClient()'s own
 * requireFirmRole(['owner','admin']) call handles it, scoped off the
 * client row's own firm_id (see GET's own FLAGGED note above, same
 * caveat applies here).
 *
 * Body fields mirror UpdateClientInput exactly (client.service.ts):
 * fullName, email, phone — all optional, at least one expected but not
 * strictly enforced here (an empty-object PATCH is a caller error, not
 * validated against, since no precedent for that check exists in any
 * pasted sibling route this session). fullName, if present, must be a
 * non-empty string — matches updateClient()'s own inline check.
 * profile_id is deliberately not accepted here, same reasoning
 * updateClient()'s own doc comment gives for excluding it from
 * UpdateClientInput's shape entirely.
 *
 * No Zod schema exists for this body in any pasted source this
 * session — validated inline with ValidationError, same posture every
 * other Client Management / Lawyer Inquiry route this session has
 * taken.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: { id: string; clientId: string } },
): Promise<NextResponse> {
  try {
    const { clientId } = context.params;
    const currentUser = await getCurrentUser();
    const body = await request.json();

    const fullName = body?.fullName;
    const email = body?.email;
    const phone = body?.phone;

    if (fullName !== undefined && (typeof fullName !== 'string' || fullName.trim().length === 0)) {
      throw new ValidationError('fullName must be a non-empty string if provided.', { received: fullName });
    }

    if (email !== undefined && (typeof email !== 'string' || email.trim().length === 0)) {
      throw new ValidationError('email must be a non-empty string if provided.', { received: email });
    }

    if (phone !== undefined && phone !== null && typeof phone !== 'string') {
      throw new ValidationError('phone must be a string if provided.', { received: phone });
    }

    const clientService = createClientService(currentUser);
    const updated = await clientService.updateClient(clientId, {
      ...(fullName !== undefined && { fullName }),
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
    });

    return NextResponse.json({ data: updated }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}