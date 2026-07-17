// src/app/api/documents/[id]/analyses/[analysisId]/route.ts
// File 69 — JurisAI Document Analysis module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentAnalysisService } from '@/modules/document-analysis/document-analysis.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via package.json):
 * dynamic route `params` is a plain synchronous object, NOT a Promise.
 * See Files 51/67/68's identical note. Extended here with the second
 * dynamic segment, `analysisId`.
 */
interface RouteContext {
  params: {
    id: string;
    analysisId: string;
  };
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]
 *
 * Fetches a single analysis run for a document. Thin route — all real
 * logic (parent-document visibility/soft-delete check, then the
 * document_id-match check preventing cross-document access to an
 * analysis row) lives in DocumentAnalysisService#getAnalysisById
 * (Amendment #20, File 65), matching every other route in this project.
 *
 * context.params is passed through whole as getAnalysisById's rawParams
 * argument — identical to how File 68 passes it to
 * listAnalysesForDocument — with analysisId additionally extracted for
 * the method's second argument. The route does no parsing or shaping of
 * either identifier itself; that stays inside the service layer.
 *
 * An analysisId that doesn't exist at all, OR that exists but belongs
 * to a different document than [id], both surface as the same
 * NotFoundError from the service layer (deliberate — see Amendment #20)
 * and both become the same 404 response here via handleApiError. This
 * route has no special-case handling for the two cases, by design.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildDocumentAnalysisService();
    const analysis = await service.getAnalysisById(
      context.params,
      context.params.analysisId,
    );

    return NextResponse.json({ data: { analysis } });
  } catch (error) {
    return handleApiError(error);
  }
}