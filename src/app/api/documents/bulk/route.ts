import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentService } from '@/modules/documents/document.factory';
import { bulkCreateDocumentsSchema } from '@/modules/documents/documents.schemas';

/**
 * POST /api/documents/bulk
 *
 * Bulk sibling of POST /api/documents (File 50) -- same "row for an
 * already-uploaded file" contract, same ownership/mime/size validation,
 * per item. This route does NOT introduce a new Service method: it loops
 * DocumentService.createDocument() (File 48) once per item, the exact
 * real method the single-document route already calls, rather than
 * inventing a bulk-specific Service method with no precedent anywhere in
 * this project to build it against.
 *
 * Per-item outcomes are DATA in the response body, not HTTP errors --
 * extending the same 'failed'-as-data convention File 67's synthesis
 * route established for Multi-document, one level down (per-item here,
 * vs per-analysis-run there). One item's AuthorizationError (storage
 * path owner mismatch) or ValidationError (bad mime type, oversized
 * file, missing title) should not fail the other items in the same
 * request.
 *
 * Uses Promise.all across items, matching DocumentService.listDocuments()'s
 * own real precedent for parallelizing independent operations (File 48)
 * -- these are independent per-row creates, same shape as that.
 *
 * Like createDocument() itself, each item's create + audit-log write is
 * already non-transactional by design (see document.service.ts's
 * class-level doc comment, "accepted, not solved" risk category, now
 * instanced a fourth time here at the item level -- not a new risk,
 * just the same one N times over).
 *
 * Response is always 200: the request itself was fully processed even if
 * zero items succeeded. A malformed envelope (not an array, empty array,
 * more than 20 items) is the only case that reaches handleApiError() as
 * a real 400/422 -- that's bulkCreateDocumentsSchema itself failing,
 * before the loop ever starts. request.json() throwing on malformed JSON
 * inherits the same existing normalizeError()-wraps-as-500 behavior
 * flagged in the single-document POST's own doc comment (File 50) --
 * not fixed here for the same reason it wasn't fixed there.
 *
 * FLAGGED, DELEGATED DECISION, NOT DRAWN FROM PRECEDENT: no bulk endpoint
 * exists anywhere else in this project to confirm envelope shape, item
 * cap, or response shape against. The 20-item cap and the
 * { created, failed, summary } response shape below are reasonable
 * defaults, not confirmed conventions -- revisit if a real requirement
 * or a sibling bulk endpoint surfaces later.
 *
 * Deliberately OUT OF SCOPE here: auto-adding created documents to a
 * document_sets entry in the same call. That would require
 * DocumentSetService (document-set.factory.ts / document-set.service.ts,
 * built last session) to be re-pasted and read in a session before this
 * route can safely call it, per the Source Verification Rule -- not
 * wired in from memory of having written it previously.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rawInput = await request.json();
    const { documents: items } = bulkCreateDocumentsSchema.parse(rawInput);

    const service = await buildDocumentService();

    const results = await Promise.all(
      items.map(async (item, index) => {
        try {
          const document = await service.createDocument(item);
          return { index, status: 'created' as const, document };
        } catch (error) {
          return {
            index,
            status: 'failed' as const,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }),
    );

    const created = results.filter(
      (r): r is { index: number; status: 'created'; document: Awaited<ReturnType<typeof service.createDocument>> } =>
        r.status === 'created',
    );
    const failed = results.filter(
      (r): r is { index: number; status: 'failed'; error: string } => r.status === 'failed',
    );

    return NextResponse.json({
      data: {
        created: created.map((r) => r.document),
        failed,
        summary: { total: items.length, succeeded: created.length, failed: failed.length },
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}