// src/app/api/notes/[id]/route.ts
//
// Same confirmed pattern as tasks/[id]/route.ts. DELETE returns a bare
// 204 No Content, not a { data: null } envelope — same real, confirmed
// project precedent that file's own header re-verified this session
// (document-sets/[id]/members/[documentId]/route.ts's actual DELETE
// handler).

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseNoteService } from '@/modules/case-notes/case-note.factory';
import { updateNoteInputSchema } from '@/modules/case-notes/case-note.schemas';

interface RouteContext {
  params: { id: string };
}

/**
 * PATCH /api/notes/[id]
 * Updates a note's content. CaseNoteService#updateNote() is
 * author-only (no case-owner override, unlike DELETE below) — a
 * non-author caller gets AuthorizationError (403) via
 * handleApiError().
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const caseNoteService = await createCaseNoteService(currentUser);

    const body = await request.json();
    const parsed = updateNoteInputSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('Invalid note payload.', parsed.error.flatten());
    }

    const note = await caseNoteService.updateNote(id, parsed.data.content);

    return NextResponse.json({ data: note });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/notes/[id]
 * Deletes a note. Author OR the case owner may delete (owner can
 * moderate their own case's notes) — enforced inside
 * CaseNoteService#deleteNote().
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const caseNoteService = await createCaseNoteService(currentUser);

    await caseNoteService.deleteNote(id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}