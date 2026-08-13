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
// factory takes no arguments and was built for a pre-auth, public read
// (see lawyer-directory.factory.ts's own header). This route is
// reached only by an authenticated caller in practice (the picker lives
// inside documents/[id], an authenticated page), but the service itself
// has no currentUser concept either way -- no factory change was needed
// to reuse it here.

import { NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildLawyerDirectoryService } from '@/modules/lawyer-inquiries/lawyer-directory.factory';

export async function GET(): Promise<NextResponse> {
  try {
    const service = await buildLawyerDirectoryService();
    const firms = await service.listFirms();

    return NextResponse.json({ data: { firms } });
  } catch (error) {
    return handleApiError(error);
  }
}