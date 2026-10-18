// src/app/api/lawyer-inquires/[id]/review/route.ts
//
// GET /api/lawyer-inquires/[id]/review
//
// The pre-acceptance review payload: the inquiry, its attached document(s)
// and their frozen AI reports (with complete / processing / unavailable
// state). Authorization is decided in LawyerInquiryReviewService; an inquiry
// the caller may not review is indistinguishable from one that does not exist.

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { buildLawyerInquiryReviewService } from '@/modules/lawyer-inquiries/lawyer-inquiry.factory';

interface RouteParams {
  params: { id: string };
}

export async function GET(_request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();
    const service = await buildLawyerInquiryReviewService(currentUser);
    const review = await service.getReview(params.id);

    return NextResponse.json({ data: review }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
