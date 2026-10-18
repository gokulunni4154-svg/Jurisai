// src/app/api/lawyer-inquires/[id]/decline/route.ts
//
// POST /api/lawyer-inquires/[id]/decline
//
// Soft decline: the inquiry is kept with status 'declined', the decider and
// timestamp; review access ends; no case or grant is created. Idempotent.
// Optional JSON body: { note?: string } (<= 1000 chars, private to reviewers).
// Authorization is entirely in the service layer and the database function.

import { NextResponse } from 'next/server';

import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { getCurrentUser } from '@/core/auth/session';
import { buildLawyerInquiryService } from '@/modules/lawyer-inquiries/lawyer-inquiry.factory';

interface RouteParams {
  params: { id: string };
}

export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: inquiryId } = params;

    if (!inquiryId) {
      throw new ValidationError('Inquiry id is required.', { received: inquiryId });
    }

    let note: string | null = null;
    const raw = await request.text();
    if (raw.trim().length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ValidationError('Request body must be valid JSON.');
      }
      const candidate =
        typeof parsed === 'object' && parsed !== null ? (parsed as { note?: unknown }).note : undefined;
      if (candidate !== undefined && candidate !== null) {
        if (typeof candidate !== 'string') {
          throw new ValidationError('note must be a string.');
        }
        note = candidate;
      }
    }

    const currentUser = await getCurrentUser();

    const service = await buildLawyerInquiryService(currentUser);
    await service.declineInquiry(inquiryId, { note });

    return NextResponse.json({ data: { declined: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
