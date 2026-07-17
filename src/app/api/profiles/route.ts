import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { buildProfileService } from '@/modules/profiles/profile.factory';

/**
 * GET /api/profiles?limit=20&offset=0
 *
 * Returns a paginated list of all profiles. Admin-only — enforced inside
 * ProfileService.listProfiles() via requireRole('admin'), not in this
 * handler. This route's only job is turning query-string params into a
 * plain object for the service to validate, and shaping the response.
 *
 * NOTE: listProfiles() returns a flat { profiles, total, limit, offset }
 * shape, not a nested { profiles, pagination } shape — there is no
 * separate pagination object to destructure. (Amendment #14 / File 32 fix.)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const rawPagination = Object.fromEntries(request.nextUrl.searchParams);

    const service = await buildProfileService();
    const { profiles, total, limit, offset } = await service.listProfiles(rawPagination);

    return NextResponse.json({ data: { profiles, total, limit, offset } });
  } catch (error) {
    return handleApiError(error);
  }
}