// src/app/api/lawyer-inquires/mine/route.ts
// NEW -- General User Terminal, "My Sent Inquiries" gap.
//
// GET /api/lawyer-inquires/mine -- thin wrapper around
// LawyerInquiryService#listMySentInquiries() (new this session). Same
// shape as the sibling GET /api/lawyer-inquires (bare, no /mine suffix)
// one directory up: real getCurrentUser(), the real
// buildLawyerInquiryService() factory (untouched -- already builds
// everything listMySentInquiries() needs, since it only adds a read
// against the same repository/service already wired), handleApiError()
// for error normalization. No new Zod schema -- no path/query param, no
// body to validate.
//
// NAMING, FLAGGED: this sits as a static `mine` segment alongside the
// existing dynamic `[id]/accept|decline|assign|convert` routes in the
// same directory -- Next.js App Router resolves the static segment
// first, so there is no collision (confirmed via
// `find src/app/api/lawyer-inquires -type f` this session: no existing
// `mine` segment anywhere in this tree). Genuinely confusing on first
// read, though, and worth flagging rather than silently living with:
// the SIBLING bare route (GET /api/lawyer-inquires, no suffix) already
// means "my inquiries" for a LAWYER caller (target_profile_id =
// auth.uid(), via listMyInquiries()). This route means "my inquiries"
// for the SENDER of an inquiry (client_profile_id = auth.uid(), via the
// new listMySentInquiries()) -- same table, same "self-scoped, no id
// param" shape, opposite column, and deliberately NOT reusing the bare
// route's URL, since a General User calling that one today would
// silently get an empty array (they're not anyone's target_profile_id)
// rather than a real 403/clear signal that they're hitting the wrong
// endpoint. Kept as two distinct URLs under the same existing
// directory, per the task's own "use the existing lawyer-inquires
// naming convention, do not globally rename it" instruction, rather
// than inventing a third top-level route prefix for one query.

import { NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { getCurrentUser } from '@/core/auth/session';
import { buildLawyerInquiryService } from '@/modules/lawyer-inquiries/lawyer-inquiry.factory';

export async function GET(): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();

    const service = await buildLawyerInquiryService(currentUser);
    const inquiries = await service.listMySentInquiries();

    return NextResponse.json({ data: inquiries });
  } catch (error) {
    return handleApiError(error);
  }
}
