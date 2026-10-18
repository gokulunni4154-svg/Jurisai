// src/app/api/lawyer-inquires/[id]/accept/route.ts
//
// POST /api/lawyer-inquires/[id]/accept
//
// Accepts an inquiry in ONE database transaction (case create/return,
// document link, case-access grant, review end, audit). Idempotent.
// Optional JSON body (an empty body is fine -- the inbox's Accept button
// sends none):
//   { title?: string, assigneeProfileId?: string | null, teamId?: string | null }
// assigneeProfileId is required when the inquiry is firm-routed (a firm
// owner/admin accepting on behalf of the firm and choosing the lawyer).
// Authorization is entirely in the service layer and the database function.

import { NextResponse } from 'next/server';

import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { getCurrentUser } from '@/core/auth/session';
import { buildLawyerInquiryService } from '@/modules/lawyer-inquiries/lawyer-inquiry.factory';

interface RouteParams {
  params: { id: string };
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`);
  }
  return value;
}

export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: inquiryId } = params;

    if (!inquiryId) {
      throw new ValidationError('Inquiry id is required.', { received: inquiryId });
    }

    let body: Record<string, unknown> = {};
    const raw = await request.text();
    if (raw.trim().length > 0) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        body = parsed as Record<string, unknown>;
      } catch {
        throw new ValidationError('Request body must be a JSON object.');
      }
    }

    const currentUser = await getCurrentUser();

    const service = await buildLawyerInquiryService(currentUser);
    const result = await service.acceptInquiry(inquiryId, {
      title: optionalString(body['title'], 'title'),
      assigneeProfileId: optionalString(body['assigneeProfileId'], 'assigneeProfileId') ?? null,
      teamId: optionalString(body['teamId'], 'teamId') ?? null,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
