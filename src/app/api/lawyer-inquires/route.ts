// src/app/api/lawyer-inquires/route.ts
//
// NEW THIS SESSION -- Lawyer Terminal audit, "My Inquiries" gap.
//
// FLAGGED, CARRIED FORWARD: this directory is genuinely spelled
// "lawyer-inquires" (missing the second "i") on disk, while every route
// file's own header comment underneath it (accept/decline/assign/
// convert, all pre-existing, untouched by this change) documents itself
// as living at "/api/lawyer-inquiries/...". That mismatch predates this
// change -- confirmed via `find src/app/api -iname "*inquir*" -type d`,
// which shows the real folder name is the misspelled one. Not corrected
// here: renaming the directory would move FOUR existing, working action
// routes (a filesystem rename, not a "genuinely missing workflow"), is
// unrelated to the list gap this file closes, and risks silently
// breaking whatever frontend already calls the current (misspelled)
// URLs. This file is placed in the SAME real directory as its sibling
// action routes so the whole module's URL prefix stays internally
// consistent, and is named to match what's actually on disk rather than
// what the comments assume.
//
// GET /api/lawyer-inquires -- thin wrapper around
// LawyerInquiryService#listMyInquiries() (new this session). Self-scoped,
// same "no id/firmId param, resolves off the authenticated caller" shape
// as GET /api/cases/mine (confirmed real precedent, source-verified this
// session) -- listMyInquiries() takes no params and filters entirely on
// requireAuthentication()'s own result.
//
// Same auth/factory/error-handling posture as every sibling route in
// this module: real getCurrentUser() (@/core/auth/session), the real
// buildLawyerInquiryService() factory (untouched -- already builds
// everything listMyInquiries() needs, since it only adds a read against
// the same repository/service already wired), handleApiError() for
// error normalization. No new Zod schema -- this route takes no input
// to validate (no path param, no query param, no body).

import { NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { getCurrentUser } from '@/core/auth/session';
import { buildLawyerInquiryService } from '@/modules/lawyer-inquiries/lawyer-inquiry.factory';

export async function GET(): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();

    const service = await buildLawyerInquiryService(currentUser);
    const inquiries = await service.listMyInquiries();

    return NextResponse.json({ data: inquiries });
  } catch (error) {
    return handleApiError(error);
  }
}
