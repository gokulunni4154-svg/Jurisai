// src/app/api/cases/[id]/notes/route.ts
//
// Mirrors cases/[id]/tasks/route.ts's real, confirmed pattern exactly:
// getCurrentUser() from @/core/auth/session, params typed synchronously
// as { id: string } (NOT a Promise — next@14.2.35 precedent), createXService(currentUser)
// from the module's factory, handleApiError() wrapping, { data: ... }
// envelope, Zod safeParse + manual ValidationError throw (same
// this-session's-own-construction flag as the tasks route carries —
// no genuine project convention for this exact wiring shape was
// re-pasted this session either).

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseNoteService } from '@/modules/case-notes/case-note.factory';
import { createNoteInputSchema } from '@/modules/case-notes/case-note.schemas';

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/cases/[id]/notes
 * Lists every note on the case. CaseNoteService#listNotesForCase()
 * explicitly re-checks access (owner or active read_write grantee
 * only) rather than relying on RLS alone — see that method's own
 * comment on why this list method is a deliberate exception to this
 * project's usual "RLS is the backstop" posture.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const caseNoteService = await createCaseNoteService(currentUser);

    const notes = await caseNoteService.listNotesForCase(id);

    return NextResponse.json({ data: notes });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/cases/[id]/notes
 * Creates a note on the case. The route's own [id] param IS the
 * authoritative caseId; author_id is derived server-side inside
 * CaseNoteService#createNote() from the authenticated user, never
 * trusted from the request body.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const caseNoteService = await createCaseNoteService(currentUser);

    const body = await request.json();
    const parsed = createNoteInputSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('Invalid note payload.', parsed.error.flatten());
    }

    const note = await caseNoteService.createNote({
      caseId: id,
      content: parsed.data.content,
    });

    return NextResponse.json({ data: note }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}