// Real path: src/app/api/dashboard/firm/[firmId]/route.ts
//
// CORRECTED after real source arrived -- hearings/[id]/route.ts was
// pasted this session, replacing the prior draft's guessed
// getCurrentUser import path and hand-rolled AppError catch block.
// Now mirrors that file's real, confirmed pattern: getCurrentUser from
// '@/core/auth/session', errors routed through the shared
// handleApiError() from '@/core/errors/error-handler' instead of a
// bespoke instanceof check, and a `{ data: ... }` response envelope
// (confirmed on that file's own PATCH handler).
//
// FLAGGED, ONE REMAINING DISCREPANCY, NOT SILENTLY RESOLVED:
// hearings/[id]/route.ts calls `await createHearingService(currentUser)`
// -- awaiting the factory call itself, suggesting that factory may be
// async. BUT firm.factory.ts and firm-member.factory.ts (both pasted
// earlier this session) are plain synchronous functions returning their
// Service directly, not Promise<Service>, and firm-dashboard.factory.ts
// was built to match THOSE two, not hearing.factory.ts (never pasted
// this session). Keeping createFirmDashboardService() un-awaited here
// rather than guessing hearing.factory.ts's real signature. If
// hearing.factory.ts turns out to be async and firm-dashboard.factory.ts
// should match it instead, both this route and the factory need a
// coordinated fix -- flag, don't silently pick one.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createFirmDashboardService } from '@/modules/firm-dashboard/firm-dashboard.factory';

interface RouteContext {
  params: { firmId: string };
}

/**
 * GET /api/dashboard/firm/[firmId]
 * Returns the firm-wide dashboard aggregate (cases, tasks, upcoming
 * hearings) for a firm's owner/admin. FirmDashboardService#getDashboard()
 * owns the single access test (caller is 'owner' or 'admin' in
 * firm_members for this firmId) -- this route does not branch on
 * caller identity itself, same posture as hearings/[id]/route.ts's
 * PATCH deferring its own access test entirely to the Service.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { firmId } = context.params;
    const currentUser = await getCurrentUser();
    const firmDashboardService = createFirmDashboardService(currentUser);

    const dashboard = await firmDashboardService.getDashboard(firmId);

    return NextResponse.json({ data: dashboard });
  } catch (error) {
    return handleApiError(error);
  }
}