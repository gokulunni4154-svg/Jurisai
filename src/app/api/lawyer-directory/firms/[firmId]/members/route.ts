// src/app/api/lawyer-directory/firms/[firmId]/members/route.ts
// NEW -- authenticated "contact a lawyer" flow, picker step 2.
//
// Next.js 14.2.35 App Router convention (confirmed via package.json in
// File 68/File 51/File 67's identical note): dynamic route `params` is
// a plain synchronous object, not a Promise.
//
// No request-body/query parsing beyond the route param itself -- thin
// route, same posture as File 68. firmId is passed straight through to
// the service; LawyerDirectoryRepository#listFirmMembers() simply
// returns an empty array for a firmId with no members (or a
// nonexistent one), matching Postgrest's own `.eq()` semantics for "no
// match" -- no explicit not-found handling needed here.

import { NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildLawyerDirectoryService } from '@/modules/lawyer-inquiries/lawyer-directory.factory';

interface RouteContext {
  params: { firmId: string };
}

export async function GET(
  _request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const service = await buildLawyerDirectoryService();
    const members = await service.listFirmMembers(context.params.firmId);

    return NextResponse.json({ data: { members } });
  } catch (error) {
    return handleApiError(error);
  }
}