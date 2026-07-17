import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentService } from '@/modules/documents/document.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via package.json):
 * dynamic route `params` is a plain synchronous object, NOT a Promise.
 * Do not "upgrade" this to `Promise<{ id: string }>` + `await` without
 * first confirming the project has actually moved to Next.js 15 — see
 * the sibling /api/profiles/[id]/route.ts (File 30) for a documented
 * example of this exact confusion (Known Issues).
 */
interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/documents/[id]
 *
 * Returns a single document. Visibility is governed entirely by RLS
 * (File 45's SELECT policy, admin branch included) — DocumentService
 * .getDocumentById() only requires that someone is authenticated, then
 * trusts whatever the RLS-scoped repository actually returns. This
 * route does no authorization logic of its own, and does not
 * pre-validate `id` itself — documentIdParamSchema.parse() runs inside
 * the service (File 48), so `context.params` is passed through as-is.
 *
 * A soft-deleted document is a 404 here, not a 200 with a deleted flag
 * — enforced inside the service, not this route.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildDocumentService();
    const document = await service.getDocumentById(context.params);

    return NextResponse.json({ data: { document } });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/documents/[id]
 *
 * Updates a document's title — the only mutable field (see
 * updateDocumentSchema's doc comment, File 46, on why storage_path/
 * mime_type/size_bytes are deliberately excluded). Authorization is
 * requireOwnership()-based with no admin override (File 48's class-level
 * doc comment explains why: File 45's RLS has no admin UPDATE policy to
 * back one up), enforced entirely inside DocumentService.updateDocument()
 * after it re-fetches the row and checks deleted_at — this route does
 * not duplicate either check.
 *
 * request.json() is not wrapped in a try/catch here, matching File 50's
 * POST handler: a malformed JSON body will currently fall through to
 * handleApiError()/normalizeError() (File 21) as a 500, not a 400. This
 * is the same inherited, project-wide limitation flagged in File 50 —
 * intentionally left unpatched here too, for the same reason (belongs in
 * File 21, for every route at once, not fixed per-file).
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const rawInput = await request.json();

    const service = await buildDocumentService();
    const document = await service.updateDocument(context.params, rawInput);

    return NextResponse.json({ data: { document } });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/documents/[id]
 *
 * Soft-deletes a document. Same requireOwnership()-based, no-admin-
 * override authorization as PATCH (see class-level doc comment on
 * DocumentService, File 48). Returns 204 No Content on success —
 * deleteDocument() resolves to void, there is no row to return, and
 * this is the first DELETE route in the project so there's no prior
 * convention to stay consistent with here.
 */
export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildDocumentService();
    await service.deleteDocument(context.params);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}