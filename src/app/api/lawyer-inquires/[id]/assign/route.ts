// src/app/api/lawyer-inquiries/[id]/assign/route.ts
// FLAGGED: same invented route path/folder caveat as accept/route.ts and
// decline/route.ts -- no existing dynamic-segment + action-suffix route
// was pasted this session for THIS action specifically, but accept/ and
// decline/ (both real, confirmed this session) already establish the
// sibling convention this file follows exactly: same folder shape
// (/api/lawyer-inquiries/[id]/<action>), same factory, same auth
// loading, same error handling.
//
// POST /api/lawyer-inquiries/:id/assign
//
// Thin wrapper around LawyerInquiryService#assignInquiry() (§4.1, the
// firm-handoff step). Body-driven -- unlike accept/decline, this action
// needs two caller-supplied values that aren't derivable from the route
// segment alone:
//   - targetProfileId (required): the lawyer being assigned the inquiry.
//   - teamId (optional, nullable): per lawyer-inquiry.service.ts's own
//     confirmed signature, assignInquiry()'s teamId param defaults to
//     null when omitted -- this route mirrors that default rather than
//     requiring the field, so a solo-firm/no-team assignment doesn't
//     need to explicitly send `teamId: null`.
//
// No Zod schema exists for this body in any pasted source this
// session -- validated inline with ValidationError, same shape accept/
// decline already use for their own path-param check, rather than
// inventing a lawyer-inquiry.schemas.ts file with no confirmed
// precedent to match.
//
// Same auth/factory/error-handling posture as accept/decline: uses the
// real getCurrentUser() (@/core/auth/session), the real
// buildLawyerInquiryService() factory, and handleApiError() for error
// normalization. Authorization itself (caller must be firm owner/admin
// of the inquiry's target firm; target lawyer must belong to that firm)
// is enforced entirely in the Service layer, not here -- this route
// does not duplicate any of that logic.
//
// Response shape: `{ data: ... }` envelope, matching accept/route.ts
// and every other route built this session -- not a raw 204, since
// assignInquiry() returns a real, non-void LawyerInquiryListing (unlike
// declineInquiry()'s void return).

import { NextResponse } from 'next/server';

import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { getCurrentUser } from '@/core/auth/session';
import { buildLawyerInquiryService } from '@/modules/lawyer-inquiries/lawyer-inquiry.factory';

interface RouteParams {
  params: { id: string };
}

interface AssignInquiryBody {
  targetProfileId?: string;
  teamId?: string | null;
}

export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: inquiryId } = params;

    if (!inquiryId) {
      throw new ValidationError('Inquiry id is required.', { received: inquiryId });
    }

    let body: AssignInquiryBody;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A valid JSON body is required.', {});
    }

    const { targetProfileId, teamId } = body;

    if (!targetProfileId || typeof targetProfileId !== 'string') {
      throw new ValidationError('targetProfileId is required.', { received: targetProfileId });
    }

    if (teamId !== undefined && teamId !== null && typeof teamId !== 'string') {
      throw new ValidationError('teamId must be a string or null.', { received: teamId });
    }

    const currentUser = await getCurrentUser();

    const service = await buildLawyerInquiryService(currentUser);
    const result = await service.assignInquiry(inquiryId, targetProfileId, teamId ?? null);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}