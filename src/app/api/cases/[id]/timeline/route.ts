// Real path: src/app/api/cases/[id]/timeline/route.ts
//
// Mirrors src/app/api/cases/[id]/hearings/route.ts's real, confirmed
// GET pattern: getCurrentUser(), params typed synchronously as
// { id: string }, a factory call, { data } envelope, handleApiError()
// wrapping. Query params (limit/offset/actionPrefix) parsed the same
// way src/app/api/hearings/upcoming/route.ts's own real, pasted GET
// parses its `from` param -- manual parseInt/string read, not a Zod
// schema, since no case-timeline.schemas.ts exists (matches
// hearings/upcoming's own precedent of a query-param route with no
// schema file, not tasks/hearings' body-validated POST/PATCH routes).
//
// FLAGGED: response envelope returns `{ data: { events, total } }` --
// i.e. CaseTimelineService's own CaseTimelineResult shape nested
// directly under `data`, not spread. Matches how every other route in
// this project returns whatever its Service method returns, unmodified,
// under a single `data` key.
//
// ACTOR ENRICHMENT DELIBERATELY NOT DONE HERE -- see
// case-timeline.service.ts's own header for the full reasoning (raw
// rows returned, frontend batch-fetches actor display names the same
// way src/app/hearings/upcoming/page.tsx batch-fetches case titles).
// Not solved in this route either.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseTimelineService } from '@/modules/case-timeline/case-timeline.factory';

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/cases/[id]/timeline
 * Returns the case's activity timeline, most recent first, plus a total
 * count for pagination. CaseTimelineService#getCaseTimeline() owns the
 * single access test (case owner, or an active grantee of either
 * access level) -- this route does not independently re-check
 * visibility.
 *
 * Query params, all optional:
 *   - limit (number): page size, clamped server-side to
 *     AuditLogRepository's own MAX_LIMIT (100).
 *   - offset (number): pagination offset.
 *   - actionPrefix (string): whole-namespace filter, e.g. 'task.' to
 *     see only task-related events on this case's timeline.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const caseTimelineService = await createCaseTimelineService(currentUser);

    const searchParams = request.nextUrl.searchParams;
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const actionPrefixParam = searchParams.get('actionPrefix');

    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined;

    const timeline = await caseTimelineService.getCaseTimeline(id, {
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
      actionPrefix: actionPrefixParam ?? undefined,
    });

    return NextResponse.json({ data: timeline });
  } catch (error) {
    return handleApiError(error);
  }
}