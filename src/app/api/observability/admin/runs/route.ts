// src/app/api/observability/admin/runs/route.ts
// JurisAI Observability module — Phase 3

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildObservabilityService } from '@/modules/observability/observability.factory';

/**
 * GET /api/observability/admin/runs
 *
 * Admin view — "every run, across every user/firm, no filter" (confirmed
 * scope). No dynamic route params, no firm-scoping of any kind.
 *
 * Authorization: NOT handled here — requireRole('admin') (no override,
 * unlike the firm-owner view's requireRole('law_firm', 'admin')) lives
 * inside ObservabilityService#getAdminRunHistory itself. Same division
 * of responsibility as every route in this project: the route layer
 * stays authorization-free, the Service layer is where "is this actor
 * allowed to do this" is decided, per base.service.ts's own stated
 * responsibility boundary.
 *
 * Deliberately a SEPARATE route from GET /api/observability/runs,
 * rather than one route branching on the caller's role — keeps the two
 * views' authorization requirements visible at the URL level (an admin
 * panel/dashboard can point at this path directly, knowing exactly what
 * role it requires, without needing to inspect response shape or a
 * query param to know which view it got back). FLAGGED AS A JUDGMENT
 * CALL, not confirmed with the user: nothing in the confirmed scope
 * mandates two routes over one branching route: revisit if a single
 * unified endpoint is preferred instead.
 *
 * No maxDuration override — same reasoning as GET /api/observability/runs:
 * pure DB reads, no inline AI provider call, so the override this
 * project's pipeline routes apply doesn't apply here either.
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const observabilityService = await buildObservabilityService();

    const runs = await observabilityService.getAdminRunHistory();

    return NextResponse.json({ data: runs }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}