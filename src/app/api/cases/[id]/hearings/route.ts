// Real path: src/app/api/cases/[id]/hearings/route.ts
//
// Mirrors cases/[id]/tasks/route.ts's real, confirmed pattern exactly:
// getCurrentUser(), params typed synchronously as { id: string },
// createHearingService(currentUser) from the factory, safeParse +
// manual ValidationError throw, handleApiError() wrapping, { data }
// envelope. Same flag that file's own header carries forward: this
// safeParse wiring shape is a repeated, consistent pattern across the
// task routes now (three of them) -- as close to "the project's real
// convention" as this codebase has for schema-validated routes.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { createHearingService } from '@/modules/hearings/hearing.factory';
import { createHearingInputSchema } from '@/modules/hearings/hearing.schemas';

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/cases/[id]/hearings
 * Lists every hearing on the case, soonest first.
 * HearingService#listHearingsForCase() checks the case exists (404s
 * otherwise) but does not independently re-check visibility beyond
 * that -- RLS (hearings_select) already scopes what comes back.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const hearingService = await createHearingService(currentUser);

    const hearings = await hearingService.listHearingsForCase(id);

    return NextResponse.json({ data: hearings });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/cases/[id]/hearings
 * Creates a hearing on the case. The route's own [id] param IS the
 * authoritative caseId; firmId is derived server-side inside
 * HearingService#createHearing() from the case's own row, never
 * trusted from the request body -- same posture as
 * cases/[id]/tasks/route.ts's POST.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const hearingService = await createHearingService(currentUser);

    const body = await request.json();
    const parsed = createHearingInputSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('Invalid hearing payload.', parsed.error.flatten());
    }

    const hearing = await hearingService.createHearing({
      caseId: id,
      hearingDate: parsed.data.hearingDate,
      hearingType: parsed.data.hearingType,
      courtName: parsed.data.courtName ?? null,
      location: parsed.data.location ?? null,
      notes: parsed.data.notes ?? null,
    });

    return NextResponse.json({ data: hearing }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}