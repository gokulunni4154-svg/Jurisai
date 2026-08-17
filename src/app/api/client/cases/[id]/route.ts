// src/app/api/client/cases/[id]/route.ts
//
// NEW FILE — Client Portal Phase 2, Client Matter / Case Workspace.
// Deliberately a SEPARATE route from /api/cases/[id] (the lawyer-
// oriented draft) — per the brief's own instruction: "Do not expose a
// lawyer-oriented endpoint to clients merely because the database RLS
// happens to filter some rows." Structural mirror of the confirmed real
// /api/dashboard/client/route.ts: getCurrentUser(), await
// createXService(currentUser) from the async factory, handleApiError()
// wrapping, { data } envelope.
//
// PARAMS SHAPE: plain synchronous `{ id: string }`, matching this
// project's confirmed Next.js 14.2.15 App Router convention (see
// api/profiles/[id]/route.ts's own header) — same shape every other
// [id]/route.ts in this project uses (cases/[id], tasks/[id],
// notes/[id], firms/[id]).
//
// No request body to validate — GET only. ClientCaseService#getCaseForClient()
// owns every authorization check (UserRole !== 'client' -> 403; no
// linked clients row -> 403 with a distinct, actionable message; a case
// this client isn't linked to -> 404 via RLS, never leaking existence)
// — this route does not duplicate any of them.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createClientCaseService } from '@/modules/client-cases/client-case.factory';

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/client/cases/[id]
 * Returns a single case's client-appropriate detail (title, status,
 * case number, dates, firm name) plus its hearings, for the current
 * authenticated client only. See ClientCaseService's own doc comment
 * for the full authorization chain.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const clientCaseService = await createClientCaseService(currentUser);

    const caseDetail = await clientCaseService.getCaseForClient(id);

    return NextResponse.json({ data: caseDetail });
  } catch (error) {
    return handleApiError(error);
  }
}
