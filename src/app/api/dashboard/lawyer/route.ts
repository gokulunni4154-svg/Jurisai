// Real path: src/app/api/dashboard/lawyer/route.ts
//
// NEW FILE, THIS SESSION. Mirrors the confirmed real pattern shared by
// every route.ts pasted this session (tasks/[id], notes/[id],
// hearings/[id], cases/[id]/hearings): getCurrentUser(), await
// createXService(currentUser) from the factory, handleApiError()
// wrapping, { data } envelope.
//
// No RouteContext/params needed here, unlike every other route pasted
// this session -- this endpoint is entirely self-scoped off the
// caller's own session (see lawyer-dashboard.service.ts's own header,
// decision #1), so there is no [id] segment.
//
// No request body to validate -- GET only, no POST/PATCH/DELETE on
// this resource. LawyerDashboardService#getDashboard() itself throws
// AuthorizationError (403, via handleApiError()) for any caller whose
// UserRole isn't 'lawyer' -- this route does not duplicate that check.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createLawyerDashboardService } from '@/modules/lawyer-dashboard/lawyer-dashboard.factory';

/**
 * GET /api/dashboard/lawyer
 * Returns the current lawyer's dashboard data: cases they can see
 * (owned or granted), tasks assigned to them, and upcoming hearings
 * they can see. 403s via handleApiError() if the caller's UserRole
 * isn't 'lawyer' -- see LawyerDashboardService#requireLawyerRole().
 */
export async function GET(_request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    const lawyerDashboardService = await createLawyerDashboardService(currentUser);

    const dashboard = await lawyerDashboardService.getDashboard();

    return NextResponse.json({ data: dashboard });
  } catch (error) {
    return handleApiError(error);
  }
}