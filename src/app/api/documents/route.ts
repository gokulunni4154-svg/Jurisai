import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentService } from '@/modules/documents/document.factory';

/**
 * GET /api/documents?limit=20&offset=0&includeDeleted=false
 *
 * Returns a paginated list of documents visible to the current actor.
 * "Visible to" is intentionally not this route's concern, or even
 * DocumentService.listDocuments()'s concern beyond requiring
 * authentication — visibility is enforced by RLS (File 45's SELECT
 * policy, which includes the admin claim branch). See File 48's
 * class-level doc comment and ARCHITECTURE.md's Legal Vault section
 * (D18) for the full rationale. This route's only job is turning the
 * query string into a plain object for the service to validate, and
 * shaping the response — same division of responsibility as
 * /api/profiles's GET (File 32).
 *
 * Response shape is `{ data: { documents, total, limit, offset } }` —
 * a flat pagination shape, per what DocumentService.listDocuments()
 * (File 48) actually returns today. Note this differs from
 * /api/profiles's `{ data: { profiles, pagination } }` nested shape
 * (File 32) — flagged as a possible convention drift between the two
 * modules, not silently normalized here, since ProfileService.listProfiles()'s
 * real pagination-object shape hasn't been re-verified this session
 * (see PROJECT_PROGRESS.md, Amendment #9).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const rawQuery = Object.fromEntries(request.nextUrl.searchParams);

    const service = await buildDocumentService();
    const { documents, total, limit, offset } = await service.listDocuments(rawQuery);

    return NextResponse.json({ data: { documents, total, limit, offset } });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/documents
 *
 * Creates a document metadata row for an already-uploaded file. Per
 * createDocumentSchema's own doc comment (File 46) and
 * DocumentService.createDocument()'s (File 48), the request body is
 * expected to carry server-derived values from a completed upload
 * (storagePath, mimeType, sizeBytes) — this route does not perform the
 * upload itself. There is no dedicated upload route yet; wiring this to
 * an actual Storage upload flow (presigned URL or direct upload) is
 * explicitly out of scope for File 50 and is open follow-up work, not an
 * oversight to gloss over.
 *
 * `request.json()` can itself throw (malformed JSON body) with a plain
 * SyntaxError, which is not an AppError or a ZodError — normalizeError()
 * (File 21) will currently wrap that as a 500 InternalServerError rather
 * than a 400. This is an existing, inherited behavior of
 * handleApiError()/normalizeError() shared by every route with a JSON
 * body (e.g. the auth routes, File 36-40), not something specific to
 * this file — flagging it here rather than silently working around it
 * only in Documents, since fixing it properly belongs in File 21 for
 * every route at once.
 *
 * Returns 201 Created with the new row, per REST convention for a
 * successful resource-creation POST — the only route so far in this
 * project that isn't a 200, since /api/profiles has no POST and the
 * auth routes' success semantics are session-establishment, not
 * resource-creation.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rawInput = await request.json();

    const service = await buildDocumentService();
    const document = await service.createDocument(rawInput);

    return NextResponse.json({ data: { document } }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}