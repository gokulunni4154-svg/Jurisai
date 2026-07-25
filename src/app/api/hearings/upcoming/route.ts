// Real path: src/app/api/hearings/upcoming/route.ts
//
// NEW route, no direct task-module precedent (tasks/mine/route.ts is
// the closest analog in shape, not pasted this session -- this route's
// own construction, flagged). Backs the calendar view --
// HearingService#listUpcomingHearings() itself has no per-user
// assignee filter (see that method's own comment); RLS narrows results
// to cases the caller owns or holds an active grant on.
//
// Accepts an optional `from` query param (ISO datetime) for a future
// "hearings after X" view; omitted means "from now".

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { isoDateTimeSchema } from '@/core/validation/common.schemas';
import { createHearingService } from '@/modules/hearings/hearing.factory';

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    const hearingService = await createHearingService(currentUser);

    const fromParam = request.nextUrl.searchParams.get('from');
    let from: string | undefined;

    if (fromParam) {
      const parsed = isoDateTimeSchema.safeParse(fromParam);
      if (!parsed.success) {
        throw new ValidationError('Invalid "from" query param.', parsed.error.flatten());
      }
      from = parsed.data;
    }

    const hearings = await hearingService.listUpcomingHearings(from);

    return NextResponse.json({ data: hearings });
  } catch (error) {
    return handleApiError(error);
  }
}