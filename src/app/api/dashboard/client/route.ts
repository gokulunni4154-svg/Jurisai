// Real path: src/app/api/dashboard/client/route.ts
//
// NEW FILE — Client Portal, Client Dashboard. Structural mirror of the
// confirmed real src/app/api/dashboard/lawyer/route.ts: getCurrentUser(),
// await createXService(currentUser) from the async factory,
// handleApiError() wrapping, { data } envelope. No RouteContext/params
// needed — self-scoped off the caller's own session, same reasoning
// lawyer/route.ts's own header gives.
//
// No request body to validate — GET only. ClientDashboardService#getDashboard()
// owns both authorization checks (UserRole !== 'client' → 403; no
// linked clients row → 403 with a distinct message) — this route does
// not duplicate either.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createClientDashboardService } from '@/modules/client-dashboard/client-dashboard.factory';

/**
 * GET /api/dashboard/client
 * Returns the current client's dashboard data: their own client
 * record, their firm's name, cases they're linked to, and upcoming
 * hearings on those cases.
 */
export async function GET(_request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    const clientDashboardService = await createClientDashboardService(currentUser);

    const dashboard = await clientDashboardService.getDashboard();

    return NextResponse.json({ data: dashboard });
  } catch (error) {
    return handleApiError(error);
  }
}
