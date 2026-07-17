// src/app/api/documents/[id]/analyses/[analysisId]/classifications/[classificationId]/route.ts
// File 99 — JurisAI Clause Classification module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildClauseClassificationService } from '@/modules/clause-classification/clause-classification.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 51/67/68/69):
 * dynamic route `params` is a plain synchronous object, NOT a Promise.
 * Extended here with the third dynamic segment, `classificationId`.
 */
interface RouteContext {
  params: {
    id: string;
    analysisId: string;
    classificationId: string;
  };
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/classifications/[classificationId]
 *
 * Fetches a single Clause Classification run. Thin route — all real
 * logic (parent-analysis visibility check via
 * DocumentAnalysisService#getAnalysisById, then the
 * document_analysis_id-match check preventing cross-analysis access to
 * a classification row) lives in
 * ClauseClassificationService#getClassificationById (File 96), matching
 * File 69's identical pattern one layer further down the pipeline.
 *
 * context.params is passed through whole as getClassificationById's
 * rawParams argument — identical to how File 69 passes it to
 * getAnalysisById — with analysisId and classificationId additionally
 * extracted for the method's second and third arguments. The route does
 * no parsing or shaping of any identifier itself; that stays inside the
 * service layer.
 *
 * A classificationId that doesn't exist at all, OR that exists but
 * belongs to a different analysis than [analysisId], both surface as
 * the same NotFoundError from the service layer (deliberate — see
 * getClassificationById's own documented cross-analysis 404 behavior,
 * mirroring Amendment #20's document_id check) and both become the same
 * 404 response here via handleApiError. This route has no special-case
 * handling for the two cases, by design — same reasoning as File 69.
 *
 * Ownership: no requireOwnership() anywhere in this call chain — this
 * is a read, following the established RLS-only-for-reads convention
 * (same as listClassificationsForAnalysis and getAnalysisById itself).
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildClauseClassificationService();
    const classification = await service.getClassificationById(
      context.params,
      context.params.analysisId,
      context.params.classificationId,
    );

    return NextResponse.json({ data: { classification } });
  } catch (error) {
    return handleApiError(error);
  }
}