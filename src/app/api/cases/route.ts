// src/app/api/cases/route.ts
//
// Thin Route Handler; all logic in the Service.
// handleApiError() is the majority error-handling pattern.
// context.params.id destructured directly, no `await` (Next
// 14.2.35, not Next 15's Promise-wrapped params).
//
// FIXED — session 55 (tsc pass): GET was calling
// caseService.listCases({ firmId, teamId }), but the real,
// pasted case.service.ts confirms listCases() takes ZERO
// arguments — it relies entirely on RLS via findManyVisible()
// to scope results to the caller, with no firmId/teamId filter
// param at all. Query-param parsing removed since it had no
// consumer once the filter object was dropped.
//
// FIXED, session 55 continued: removing the searchParams parsing
// above left GET's `request` param unused (only createCaseService()
// and listCases() are called, neither of which reads it) — tsc's
// noUnusedParameters flagged it (TS6133). Prefixed with `_`, same
// convention used across every other route this session
// (grants/route.ts's GET, etc.).
//
// FLAGGED, NOT RESOLVED HERE: GET /api/cases has no server-side way
// to filter by firm or team — a caller visible into multiple firms
// gets everything RLS allows, undifferentiated. May be intentional
// (client-side filtering) or a real gap if the frontend needs a
// firm/team-scoped view. Not decided here.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseService } from '@/modules/cases/case.factory';

/**
 * GET /api/cases
 * Lists cases visible to the caller (owner, active grantee, or firm
 * admin — per CaseService#listCases()'s RLS-backed scoping).
 */
export async function GET(_request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    const caseService = await createCaseService(currentUser);

    const cases = await caseService.listCases();

    return NextResponse.json({ data: cases });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/cases
 * Creates a case. Gated by CaseService's own requireCaseCreateAccess()
 * (team lead of teamId if given, else firm admin/owner of firmId) —
 * FLAGGED per the continuation prompt: a solo case owner who is not
 * also a firm admin currently cannot create/grant on their own case.
 * Not fixed here — carried forward as-is.
 */
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    const caseService = await createCaseService(currentUser);

    const body = await request.json();
    const { firmId, teamId, title } = body;

    const newCase = await caseService.createCase({
      firmId,
      teamId,
      title,
    });

    return NextResponse.json({ data: newCase }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}