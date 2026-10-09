// src/app/api/lawyer-directory/firms/route.ts
// NEW -- authenticated "contact a lawyer" flow, picker step 1.
//
// Thin route, matching this project's established convention (e.g.
// File 68's GET /api/documents/[id]/analyses): translates HTTP <->
// service call only, no business logic here. See
// LawyerDirectoryRepository#listFirms()'s own doc comment for why this
// returns every firm unfiltered (no firm-level verification concept
// exists yet).
//
// Deliberately reuses buildLawyerDirectoryService() as-is -- that
// factory takes no arguments (see lawyer-directory.factory.ts's own
// header) and the service has no currentUser concept.
//
// AUTH REQUIRED (P2-01 fix): previously this route was reachable by
// anonymous callers (middleware lets every /api/* request through, and
// the route itself never checked), exposing the directory through the
// admin client. The route now requires a session and returns 401
// otherwise; the gate is here, in the route, not in the service. Only
// organization_type = 'firm' rows are listed -- see
// LawyerDirectoryRepository#listFirms().

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { AuthenticationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { buildLawyerDirectoryService } from '@/modules/lawyer-inquiries/lawyer-directory.factory';

// Live directory data: must not be prerendered at build time.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      throw new AuthenticationError();
    }

    const service = await buildLawyerDirectoryService();
    const firms = await service.listFirms();

    return NextResponse.json({ data: { firms } });
  } catch (error) {
    return handleApiError(error);
  }
}