// src/app/api/firms/[id]/lawyer-inquires/route.ts
//
// GET /api/firms/[id]/lawyer-inquires
//
// Firm Terminal inquiry inbox. Firm owner/admin only (the existing firm
// authorization rule); anyone else, including an employee of the firm or a
// member of another firm, is rejected by the service.

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
    const inquiries = await service.listFirmInquiries(params.id);

    return NextResponse.json({ data: inquiries }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
