// src/app/api/lawyer-directory/firms/[firmId]/members/route.ts
// NEW -- authenticated "contact a lawyer" flow, picker step 2.
//
// Next.js 14.2.35 App Router convention (confirmed via package.json in
// File 68/File 51/File 67's identical note): dynamic route `params` is
// a plain synchronous object, not a Promise.
//
// No request-body/query parsing beyond the route param itself -- thin
// route, same posture as File 68.
//
// P2-01 fix: (1) requires a session (401 otherwise) -- previously this
// route was reachable anonymously through the admin client; (2) firmId
// is validated with the shared uuidSchema before reaching the service
// (a ZodError becomes a 400 ValidationError via handleApiError, same
// as api/profiles/[id]); (3) LawyerDirectoryRepository#listFirmMembers()
// returns an empty array for a firmId that is nonexistent OR belongs to
// a 'personal' organization, so a personal org's roster can never be
// fetched through this directory.

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { AuthenticationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { uuidSchema } from '@/core/validation/common.schemas';
import { buildLawyerDirectoryService } from '@/modules/lawyer-inquiries/lawyer-directory.factory';

interface RouteContext {
  params: { firmId: string };
}

export async function GET(
  _request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      throw new AuthenticationError();
    }

    const firmId = uuidSchema.parse(context.params.firmId);

    const service = await buildLawyerDirectoryService();
    const members = await service.listFirmMembers(firmId);

    return NextResponse.json({ data: { members } });
  } catch (error) {
    return handleApiError(error);
  }
}