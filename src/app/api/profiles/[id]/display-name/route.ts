import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { buildProfileService } from '@/modules/profiles/profile.factory';
import { profileIdParamSchema } from '@/modules/profiles/profile.schemas';

/**
 * Next.js 14.2.15 App Router convention (confirmed via package.json, see
 * src/app/api/profiles/[id]/route.ts's own header): dynamic route `params`
 * is a plain synchronous object, NOT a Promise. Matched here for
 * consistency with the sibling route this one sits next to.
 */
interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/profiles/[id]/display-name
 *
 * NEW route -- added this session to close Case Timeline open item #3
 * (see PROJECT_PROGRESS.md's "Real open items on Case Timeline"). Returns
 * ONLY { id, full_name } for the given profile id, and is callable by
 * ANY authenticated user -- not just that profile's owner or an admin.
 *
 * Deliberately a SEPARATE route from GET /api/profiles/[id], not a query
 * param / mode flag on that route:
 *   - Keeps the existing, ownership-restricted full-profile route's
 *     authorization exactly as it was -- nothing about it changes here.
 *   - Makes the looser access pattern explicit and easy to find/audit as
 *     its own file, rather than a conditional branch buried inside a
 *     route that's otherwise ownership-gated.
 *
 * Authorization is enforced entirely inside
 * ProfileService.getPublicDisplayName() (requireAuthentication() only --
 * see that method's own header for the full reasoning on why this one
 * method deliberately does not mirror the profiles RLS ownership policy
 * the rest of this module follows). This route handler does no
 * authorization logic of its own, matching the convention of its sibling
 * route -- only param validation and delegation.
 *
 * Known caller (as of this session): the Case Timeline frontend page,
 * to resolve each audit-log entry's actor_id into a display name.
 * NOTE: that page's own source has not been re-pasted/re-verified this
 * session -- it currently points at GET /api/profiles/[id], not this new
 * route. It must be updated to call this route instead before actor
 * names will resolve correctly for non-owner/non-admin viewers. Flagged,
 * not yet done -- see PROJECT_PROGRESS.md.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = profileIdParamSchema.parse(context.params);

    const service = await buildProfileService();
    const displayName = await service.getPublicDisplayName(id);

    return NextResponse.json({ data: displayName });
  } catch (error) {
    return handleApiError(error);
  }
}