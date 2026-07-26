// src/app/api/firms/[id]/reports/route.ts
// Reports & Analytics — Phase 4, File 4 of 5. GET the combined firm
// dashboard (case status counts, task status counts, upcoming hearings,
// active subscription/plan).
//
// SOURCE VERIFICATION NOTE: built directly against this session's real,
// pasted reports.service.ts (ReportsService#getFirmDashboard()) and
// reports.factory.ts (createReportsService()), plus the real, pasted
// /api/firms/[id]/route.ts as the confirmed route-shape precedent
// (try/catch, getCurrentUser(), factory call, NextResponse.json({data},
// {status:200}), handleApiError()).
//
// PARAM NAME, FLAGGED: this route lives under the same /api/firms/[id]/
// segment as the pasted /api/firms/[id]/route.ts and
// /api/firms/[id]/members/route.ts, both of which use `id` (not
// `firmId`) — matching that for the same reason /api/firms/[id]/route.ts
// itself gives: direct sibling under the same [id] segment. The
// project-wide `id` vs `firmId` inconsistency this touches on is Open
// Item #85, carried forward unresolved — not silently fixed here.
//
// PARAMS DESTRUCTURING, FLAGGED: `context.params` destructured directly,
// not awaited — inherited from /api/firms/[id]/route.ts's own real,
// pasted precedent (itself inherited from members/route.ts, confirmed
// via package.json in an earlier session per that file's own comment).
// Not re-confirmed independently in this session.
//
// AUTHORIZATION: NOT handled in this route. ReportsService#getFirmDashboard()
// itself gates to owner/admin FirmRoles via requireDashboardAccess() and
// throws on failure — same division of responsibility as
// /api/firms/[id]/route.ts's GET, which defers identically to
// FirmService#getFirmById()'s own requireManageAccess() gate.
//
// QUERY PARAMS, FLAGGED — NOT IMPLEMENTED: ReportsService#getFirmDashboard()
// takes an optional `hearingsLimit` (default 5, itself flagged as an
// arbitrary unconfirmed choice in reports.service.ts's own comment).
// This route does NOT expose a `?hearingsLimit=` query param to let the
// frontend override it — no real precedent for query-param-driven
// report tuning exists anywhere in this project's pasted source, and
// File 5 (frontend page) hasn't been built yet to confirm it needs one.
// Left as a fixed call to the service's own default rather than
// inventing new scope. Revisit if File 5 needs it.
//
// RESPONSE SHAPE: `{ data }` at 200, matching the confirmed
// `{data},{status:200}` convention every other GET route in this
// project uses — not the bare-204 alternative flagged as Open Item #84
// elsewhere (irrelevant here since this is a read, not a write with no
// body).

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createReportsService } from '@/modules/reports/reports.factory';

/**
 * GET /api/firms/[id]/reports
 *
 * Returns the combined firm dashboard: case status counts, task status
 * counts, upcoming hearings, and the firm's active subscription/plan.
 * Authorization NOT handled here — see file-level comment above.
 */
export async function GET(
  _request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;

    const currentUser = await getCurrentUser();
    const reportsService = await createReportsService(currentUser);
    const dashboard = await reportsService.getFirmDashboard(firmId);

    return NextResponse.json({ data: dashboard }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}