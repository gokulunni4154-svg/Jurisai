// src/app/api/documents/[id]/analyses/[analysisId]/legal-health-scores/[legalHealthScoreId]/route.ts
// File 139 — JurisAI Legal Health Score module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildLegalHealthScoreService } from '@/modules/legal-health-score/legal-health-score.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 51/67/68/69,
 * reused unchanged through Files 107, 115, 123, and 131): dynamic route
 * `params` is a plain synchronous object, NOT a Promise. Extended here
 * with the third dynamic segment, `legalHealthScoreId`.
 */
interface RouteContext {
  params: {
    id: string;
    analysisId: string;
    legalHealthScoreId: string;
  };
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/legal-health-scores/[legalHealthScoreId]
 *
 * Fetches a single Legal Health Score run. Thin route — all real logic
 * (parent-analysis visibility check via
 * DocumentAnalysisService#getAnalysisById, called inside
 * LegalHealthScoreService#getLegalHealthScoreById, then the
 * document_analysis_id-match check preventing cross-analysis access to
 * a legal_health_scores row) lives in
 * LegalHealthScoreService#getLegalHealthScoreById (File 136), matching
 * Files 131's, 123's, 115's, and 107's identical pattern at the same
 * pipeline depth.
 *
 * context.params is passed through whole as getLegalHealthScoreById's
 * rawParams argument — identical to how File 131 passes it to
 * getAIRecommendationById — with analysisId and legalHealthScoreId
 * additionally extracted for the method's second and third arguments.
 * The route does no parsing or shaping of any identifier itself; that
 * stays inside the service layer.
 *
 * A legalHealthScoreId that doesn't exist at all, OR that exists but
 * belongs to a different analysis than [analysisId], both surface as
 * the same NotFoundError from the service layer (deliberate — see
 * getLegalHealthScoreById's own documented cross-analysis 404 behavior,
 * mirroring getAIRecommendationById's, getComplianceDetectionById's,
 * getMissingClauseDetectionById's, and getRiskDetectionById's identical
 * checks) and both become the same 404 response here via
 * handleApiError. This route has no special-case handling for the two
 * cases, by design — same reasoning as Files 131, 123, 115, and 107.
 *
 * Ownership: no requireOwnership() anywhere in this call chain — this
 * is a read, following the established RLS-only-for-reads convention.
 *
 * No maxDuration export, same reasoning as Files 131, 107, 115, and
 * 123 — a pure read has no long-running AI call to bound, unlike File
 * 138's POST handler.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildLegalHealthScoreService();
    const legalHealthScore = await service.getLegalHealthScoreById(
      context.params,
      context.params.analysisId,
      context.params.legalHealthScoreId,
    );

    return NextResponse.json({ data: { legalHealthScore } });
  } catch (error) {
    return handleApiError(error);
  }
}