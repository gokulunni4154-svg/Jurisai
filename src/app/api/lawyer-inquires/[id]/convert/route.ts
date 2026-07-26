// src/app/api/lawyer-inquiries/[id]/convert/route.ts
// FLAGGED: same invented route path/folder caveat as accept/, decline/,
// and assign/route.ts -- no existing pasted source confirmed THIS
// action's route shape specifically, but the other three (accept,
// decline, assign -- accept/decline real and confirmed this session,
// assign built as their direct sibling last turn) establish the
// convention this file follows exactly: same folder shape
// (/api/lawyer-inquiries/[id]/<action>), same factory, same auth
// loading, same error handling, same response envelope.
//
// POST /api/lawyer-inquiries/:id/convert
//
// Thin wrapper around LawyerInquiryService#convertInquiry() (§2 step
// 10, §4.5). Body-driven, single required field:
//   - title (required): the new case's title, per convertInquiry()'s
//     own confirmed signature (inquiryId: string, title: string). Not
//     derived from anything server-side -- the scoping doc treats this
//     as caller-supplied, same as CaseService#createCase()'s own title
//     param.
//
// No teamId field on this route's body -- unlike assign/route.ts,
// convertInquiry() does NOT take teamId as a parameter. Per
// lawyer-inquiry.service.ts's own doc comment, teamId is read
// server-side from row.team_id (set earlier, at assignInquiry() time)
// and passed straight through to CaseService#createCase() internally --
// this route has no reason to accept or forward a teamId value, and
// doing so would be silently ignored by the Service layer either way.
//
// No Zod schema exists for this body in any pasted source this
// session -- validated inline with ValidationError, same posture
// assign/route.ts already adopted for its own body, rather than
// inventing a schema file with no confirmed precedent.
//
// Same auth/factory/error-handling posture as accept/decline/assign:
// real getCurrentUser() (@/core/auth/session), real
// buildLawyerInquiryService() factory, handleApiError() for error
// normalization. Authorization (only an 'accepted' inquiry may
// convert; CaseService's own requireCaseCreateAccess() gates who may
// create the resulting case) is enforced entirely in the Service
// layer -- this route does not duplicate any of it.
//
// FLAGGED, CARRIED FROM lawyer-inquiry.service.ts's own doc comment:
// convertInquiry() is non-transactional (createCase() then
// repository.convert() as two separate calls) -- if the second call
// fails after the first succeeds, a real case would exist with the
// inquiry still reading 'accepted'. Not something this route layer can
// fix; noted here so it isn't lost moving from Service doc comment to
// route file.
//
// Response shape: `{ data: ... }` envelope, matching every other route
// in this module -- convertInquiry() returns a real, non-void
// LawyerInquiryListing.

import { NextResponse } from 'next/server';

import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { getCurrentUser } from '@/core/auth/session';
import { buildLawyerInquiryService } from '@/modules/lawyer-inquiries/lawyer-inquiry.factory';

interface RouteParams {
  params: { id: string };
}

interface ConvertInquiryBody {
  title?: string;
}

export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: inquiryId } = params;

    if (!inquiryId) {
      throw new ValidationError('Inquiry id is required.', { received: inquiryId });
    }

    let body: ConvertInquiryBody;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A valid JSON body is required.', {});
    }

    const { title } = body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      throw new ValidationError('title is required.', { received: title });
    }

    const currentUser = await getCurrentUser();

    const service = await buildLawyerInquiryService(currentUser);
    const result = await service.convertInquiry(inquiryId, title);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}