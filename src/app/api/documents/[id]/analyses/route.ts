// src/app/api/documents/[id]/analyses/route.ts
// File 68 — JurisAI Document Analysis module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentAnalysisService } from '@/modules/document-analysis/document-analysis.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via package.json):
 * dynamic route `params` is a plain synchronous object, NOT a Promise.
 * See Files 51/67's identical note.
 */
interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/documents/[id]/analyses
 *
 * Lists all analysis runs for a document, most recent first. Thin route
 * — all real logic (parent-document visibility/soft-delete check, then
 * the actual list query) lives in
 * DocumentAnalysisService#listAnalysesForDocument (Amendment #19, File
 * 65), matching every other route in this project: routes translate
 * HTTP <-> service calls, they do not contain business logic or
 * authorization decisions themselves.
 *
 * No pagination on this list yet (unlike GET /api/documents, File 50,
 * whose ListDocumentsResult includes limit/offset/total). Not an
 * oversight — flagged as a real, deliberate gap: a single document is
 * expected to accumulate at most a handful of analysis runs, not
 * thousands, so pagination wasn't built ahead of a need that doesn't
 * clearly exist yet, unlike BaseRepository#count (File 22), which WAS
 * built ahead of need because pagination for large lists (documents,
 * the future Lawyer Marketplace, Admin Panel) was a near-certainty.
 * Revisit if that assumption turns out wrong.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildDocumentAnalysisService();
    const analyses = await service.listAnalysesForDocument(context.params);

    return NextResponse.json({ data: { analyses } });
  } catch (error) {
    return handleApiError(error);
  }
}