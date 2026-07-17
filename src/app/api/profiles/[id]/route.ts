import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildProfileService } from '@/modules/profiles/profile.factory';
import { profileIdParamSchema } from '@/modules/profiles/profile.schemas';

/**
 * Next.js 14.2.15 App Router convention (confirmed via package.json):
 * dynamic route `params` is a plain synchronous object, NOT a Promise.
 * This was previously (incorrectly) typed as Promise<{ id: string }>
 * and awaited — see Amendment #10. That didn't throw at runtime
 * (awaiting a non-Promise just resolves immediately to itself), but it
 * was semantically wrong and implied a Next 15 target this project
 * doesn't have. Do not "upgrade" this back to a Promise without first
 * confirming an actual move to Next.js 15.
 */
interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/profiles/[id]
 *
 * Returns the profile for the given id. Authorization is enforced entirely
 * inside ProfileService.getProfileById() via requireOwnership(id, { allowRoles: ['admin'] }):
 * the caller must either own the profile or hold the admin role. This route
 * handler does no authorization logic of its own — only param validation
 * and delegation.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = profileIdParamSchema.parse(context.params);

    const service = await buildProfileService();
    const profile = await service.getProfileById(id);

    return NextResponse.json({ data: profile });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/profiles/[id]
 *
 * Updates the profile for the given id. As with GET, authorization is
 * enforced inside ProfileService.updateProfile() via requireOwnership(),
 * and — per File 28's design — that authorization check runs before the
 * request body is even parsed, so an unauthorized caller is rejected
 * without the cost of validating a payload they were never allowed to send.
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = profileIdParamSchema.parse(context.params);

    let rawInput: unknown;
    try {
      rawInput = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const service = await buildProfileService();
    const profile = await service.updateProfile(id, rawInput);

    return NextResponse.json({ data: profile });
  } catch (error) {
    return handleApiError(error);
  }
}