// src/app/api/observability/runs/route.ts
// JurisAI Observability module — Phase 3

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildObservabilityService } from '@/modules/observability/observability.factory';

/**
 * GET /api/observability/runs
 *
 * Firm-owner view — "every run across every document belonging to the
 * calling user's own firm" (confirmed scope). No dynamic route params:
 * unlike every document-analysis-scoped route in this project (Files
 * 67/98/106/.../146, all take [id]/[analysisId]), this route is not
 * scoped to one document — the firm itself is resolved server-side from
 * the authenticated caller's own profile
 * (ObservabilityService#getFirmRunHistory, not this route), never from
 * a client-suppliable parameter. See that method's own doc comment for
 * the full reasoning.
 *
 * Authorization: NOT handled here, same as every route in this
 * project — requireRole('law_firm', 'admin') lives inside
 * ObservabilityService#getFirmRunHistory itself and throws
 * AuthorizationError/AuthenticationError, which handleApiError below
 * translates to the correct HTTP status. This route has no
 * authorization logic of its own, consistent with the GET handler
 * convention already established in Files 106/114/122/130/138/146 (no
 * requireOwnership at the route layer for reads).
 *
 * No maxDuration override, unlike the pipeline routes (Files 67 through
 * 146) that all set `export const maxDuration = 60` — that override
 * exists specifically because those routes make an inline AI provider
 * call. This route only reads from the eight module repositories plus
 * profiles/documents/document_analyses; there is no AI call here, so
 * the reasoning behind that override does not apply and it is
 * deliberately omitted rather than copied by default.
 *
 * No query-param filtering (module/status/date-range) in this first
 * pass — nothing in the confirmed scope calls for it yet. Straightforward
 * to add later without a breaking change to this route's shape.
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const observabilityService = await buildObservabilityService();

    const runs = await observabilityService.getFirmRunHistory();

    return NextResponse.json({ data: runs }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}