// src/app/api/lawyer-inquires/[id]/documents/[documentId]/access/route.ts
//
// GET /api/lawyer-inquires/[id]/documents/[documentId]/access
//
// Returns a short-lived signed URL for ONE document of ONE inquiry, after the
// same authorization as the review payload. documentId is the
// lawyer_inquiry_documents id and is matched together with the inquiry id.
// Never cached; each call mints (and audits) a fresh link.

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { buildLawyerInquiryReviewService } from '@/modules/lawyer-inquiries/lawyer-inquiry.factory';

interface RouteParams {
  params: { id: string; documentId: string };
}

export async function GET(_request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();
    const service = await buildLawyerInquiryReviewService(currentUser);
    const access = await service.getDocumentAccess(params.id, params.documentId);

    return NextResponse.json({ data: access }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
