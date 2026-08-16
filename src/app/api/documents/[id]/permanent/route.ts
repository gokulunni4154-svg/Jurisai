// src/app/api/documents/[id]/permanent/route.ts
//
// NEW — Trash: Permanent delete. Closes the second half of the gap
// flagged in src/app/documents/page.tsx's own header comment ("...
// Delete permanently are disabled with 'Coming soon' ... there is no
// restore or hard-delete route anywhere in the API").
//
// DELETE on a /permanent sub-path, not a second DELETE handler on
// /api/documents/[id] itself — that route's existing DELETE is
// confirmed soft-delete-only (see its own doc comment, which multiple
// other files, including this project's continuation-prompt-driven
// audits, already cite as the reason this gap exists). Overloading the
// same route+verb pair with a body flag or query param to select
// soft-vs-hard delete would make an already-irreversible operation one
// typo away from silently deleting the wrong thing; a distinct path is
// the safer, more explicit choice, matching how /download and /restore
// are already their own sub-paths on this same resource rather than
// query-param variants of GET/POST.
//
// Same Next.js 14.2.15 synchronous-params convention as the sibling
// /api/documents/[id]/route.ts.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentService } from '@/modules/documents/document.factory';

interface RouteContext {
  params: { id: string };
}

/**
 * DELETE /api/documents/[id]/permanent
 *
 * Irreversibly deletes a document that is already in the trash — the
 * Postgres row and its underlying Storage object are both removed (see
 * DocumentService.permanentlyDeleteDocument()'s own doc comment for the
 * exact ordering and the accepted, flagged risk if the Storage removal
 * step fails after the row is already gone). Owner-only, no admin
 * override, same posture as every other write in this module.
 *
 * A document that is not currently in the trash surfaces as
 * ConflictError (409); a document that doesn't exist / isn't visible to
 * this actor surfaces as NotFoundError (404) — both via
 * handleApiError(), same as every other route in this module. Returns
 * 204 No Content on success, matching the soft-delete DELETE route's
 * own convention.
 */
export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildDocumentService();
    await service.permanentlyDeleteDocument(context.params);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
