// Real path: src/app/api/hearings/[id]/route.ts
//
// Mirrors tasks/[id]/route.ts's real, confirmed pattern exactly,
// including the DELETE-204 (bare, no envelope) shape confirmed against
// that project's real precedent.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { createHearingService } from '@/modules/hearings/hearing.factory';
import { updateHearingInputSchema } from '@/modules/hearings/hearing.schemas';

interface RouteContext {
  params: { id: string };
}

/**
 * PATCH /api/hearings/[id]
 * Updates a hearing. HearingService#updateHearing() owns the single
 * access test (case owner or active read_write grantee) -- this route
 * does not need to branch on caller identity, unlike
 * tasks/[id]/route.ts's PATCH, since hearings have no assignee-vs-
 * manager distinction.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const hearingService = await createHearingService(currentUser);

    const body = await request.json();
    const parsed = updateHearingInputSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('Invalid hearing payload.', parsed.error.flatten());
    }

    const hearing = await hearingService.updateHearing(id, {
      hearingDate: parsed.data.hearingDate,
      hearingType: parsed.data.hearingType,
      courtName: parsed.data.courtName,
      location: parsed.data.location,
      notes: parsed.data.notes,
      outcome: parsed.data.outcome,
    });

    return NextResponse.json({ data: hearing });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/hearings/[id]
 * Deletes a hearing. Same access test as PATCH -- no assignee
 * exclusion needed, unlike tasks/[id]/route.ts's DELETE.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const hearingService = await createHearingService(currentUser);

    await hearingService.deleteHearing(id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}