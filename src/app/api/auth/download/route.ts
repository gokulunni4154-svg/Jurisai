import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentService } from '@/modules/documents/document.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via package.json):
 * dynamic route `params` is a plain synchronous object, NOT a Promise.
 * See /api/profiles/[id]/route.ts (File 30, Amendment #10) for the
 * documented example of getting this wrong.
 */
interface RouteContext {
  params: { id: string };
}

/**
 * Must match DocumentService.getDownloadUrl()'s repository call
 * (document.repository.ts, Amendment #12) — duplicated here only for
 * the response payload, not re-derived independently. If the
 * repository's default expiry ever changes, this response's
 * `expiresInSeconds` field would silently go stale; there is currently
 * no shared constant between the two. Flagged as a known duplication
 * risk, same category as documents.schemas.ts's own
 * ALLOWED_MIME_TYPES/MAX_FILE_SIZE_BYTES comments — not fixed here
 * since it would mean exporting a Storage-layer constant out of the
 * repository for a route to import, which is a small enough design
 * question to flag rather than decide unilaterally.
 */
const SIGNED_URL_EXPIRES_IN_SECONDS = 300;

/**
 * GET /api/documents/[id]/download
 *
 * Returns a short-lived signed URL for downloading a document's
 * underlying file from Storage. Response is JSON (`{ data: { url,
 * expiresInSeconds } }`), not an HTTP redirect — consistent with every
 * other route in this project, and it lets the client control how the
 * download is actually initiated (new tab, named download, a "link
 * expires soon" hint) rather than the browser just following a 302
 * blindly.
 *
 * Authorization is entirely inside DocumentService.getDownloadUrl()
 * (Amendment #13): RLS-scoped visibility plus an explicit soft-delete
 * check, mirroring GET /api/documents/[id]'s own authorization model.
 * This route does no authorization logic of its own.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildDocumentService();
    const url = await service.getDownloadUrl(context.params);

    return NextResponse.json({
      data: { url, expiresInSeconds: SIGNED_URL_EXPIRES_IN_SECONDS },
    });
  } catch (error) {
    return handleApiError(error);
  }
}