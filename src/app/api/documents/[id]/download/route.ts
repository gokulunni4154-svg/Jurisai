import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentService } from '@/modules/documents/document.factory';

/**
 * GET /api/documents/[id]/download
 *
 * File 57 — referenced by document.repository.ts (Amendment #12,
 * createSignedDownloadUrl) and document.service.ts (Amendment #13,
 * getDownloadUrl) but never actually built/pasted in any prior session.
 * Built fresh this session against those two real methods, not
 * reconstructed from a lost original.
 *
 * Same division of responsibility as every other route: turn the URL
 * segment into a plain object, hand it to the Service, shape the
 * response. DocumentService.getDownloadUrl() already does the real work
 * — RLS-scoped fetch via findByIdOrThrow, soft-delete check, then the
 * repository's signed-URL call against a storage_path this same request
 * already proved visible. See that method's own doc comment for why
 * this route (or anything else) must never call
 * DocumentRepository.createSignedDownloadUrl() directly.
 *
 * FLAGGED, SAME UNVERIFIED PARAMS CONVENTION AS notifications/[id]/read:
 * `{ params }: { params: Promise<{ id: string }> }` is Next.js 14's App
 * Router convention, not confirmed against any real dynamic-segment
 * route in this codebase — none has ever been pasted. If a real one
 * ever surfaces, both this file and the notifications mark-read route
 * need to match it, not the other way around.
 *
 * RESPONSE SHAPE, FLAGGED AS A DELIBERATE DIVERGENCE, NOT A MATCH:
 * File 172 (PDF Export's signed-URL route, per PROJECT_PROGRESS.md)
 * returns `{ data: { url, expiresInSeconds } }`. This route returns only
 * `{ data: { url } }`, because DocumentService.getDownloadUrl() itself
 * only returns the signed URL string — it does not surface the
 * expiresInSeconds value (currently hardcoded at 300 inside
 * DocumentRepository.createSignedDownloadUrl(), never passed back up).
 * Matching File 172's shape exactly would mean amending
 * getDownloadUrl()'s return type to `{ url, expiresInSeconds }`, which
 * is a Service-layer change out of scope for just writing this route —
 * not done silently here. Revisit if consistency with File 172's shape
 * ever becomes a real requirement.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const service = await buildDocumentService();
    const url = await service.getDownloadUrl({ id });

    return NextResponse.json({ data: { url } });
  } catch (error) {
    return handleApiError(error);
  }
}