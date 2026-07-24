// src/app/api/lawyers/route.ts
// FLAGGED: folder name "lawyers" inherits the same invented-path caveat
// as the route path itself (see doc comment below) -- if the real
// convention differs (e.g. app/api/lawyer-directory/route.ts), only
// this file's location on disk needs to move.

import { NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildLawyerDirectoryService } from '@/modules/lawyer-inquiries/lawyer-directory.factory';

/**
 * GET /api/lawyers
 *
 * Public, pre-auth listing of verified individual lawyers -- scoping
 * doc §2 step 2. No auth check here at all, matching
 * LawyerDirectoryService's own no-currentUser design (see that file's
 * header comment) -- there is nothing to authenticate against for a
 * visitor who hasn't even uploaded a document yet, let alone signed up.
 *
 * FLAGGED: no query params handled (no pagination, no filtering) --
 * same reasoning as LawyerDirectoryService's own flag: nothing in the
 * scoping doc specifies these, and no frontend directory-page source
 * was pasted this session to confirm what it needs. If/when pagination
 * is added, this is the file that would gain `?page=`/`?limit=` parsing
 * -- not attempted now rather than guessing shape.
 *
 * FLAGGED: route path itself (`/api/lawyers`) is invented -- no
 * existing route naming convention for a "directory" or "listing"
 * style endpoint was found in pasted source this session to confirm
 * against (every other route seen -- /api/analysis/anonymous,
 * /api/auth/sign-in -- is either a specific action or resource
 * singular, not a browse/list endpoint). If the real project convention
 * differs (e.g. `/api/lawyer-directory`, or nested under
 * `/api/lawyer-inquiries/lawyers`), only this file's path needs to
 * move -- nothing else in the chain depends on the literal route path.
 *
 * FLAGGED: unlike the other two route-adjacent files seen this session
 * (sign-in's POST, the anonymous analysis POST), this is a GET with no
 * request body to parse -- so there's no ValidationError/JSON-parsing
 * step here, deliberately, not an omission.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const service = await buildLawyerDirectoryService();
    const lawyers = await service.listVerifiedLawyers();

    return NextResponse.json({ data: lawyers });
  } catch (error) {
    return handleApiError(error);
  }
}