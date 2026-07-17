// src/app/api/documents/[id]/analyses/[analysisId]/ai-recommendations/[aiRecommendationId]/route.ts
// File 131 — JurisAI AI Recommendation module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildAIRecommendationService } from '@/modules/ai-recommendation/ai-recommendation.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 51/67/68/69,
 * reused unchanged through Files 107, 115, and 123): dynamic route
 * `params` is a plain synchronous object, NOT a Promise. Extended here
 * with the third dynamic segment, `aiRecommendationId`.
 */
interface RouteContext {
  params: {
    id: string;
    analysisId: string;
    aiRecommendationId: string;
  };
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/ai-recommendations/[aiRecommendationId]
 *
 * Fetches a single AI Recommendation run. Thin route — all real logic
 * (parent-analysis visibility check via
 * DocumentAnalysisService#getAnalysisById, called inside
 * AIRecommendationService#getAIRecommendationById, then the
 * document_analysis_id-match check preventing cross-analysis access to
 * an ai_recommendations row) lives in
 * AIRecommendationService#getAIRecommendationById (File 128), matching
 * Files 123's, 115's, and 107's identical pattern at the same pipeline
 * depth.
 *
 * context.params is passed through whole as getAIRecommendationById's
 * rawParams argument — identical to how File 123 passes it to
 * getComplianceDetectionById, File 115 to
 * getMissingClauseDetectionById, and File 107 to getRiskDetectionById —
 * with analysisId and aiRecommendationId additionally extracted for the
 * method's second and third arguments. The route does no parsing or
 * shaping of any identifier itself; that stays inside the service
 * layer.
 *
 * An aiRecommendationId that doesn't exist at all, OR that exists but
 * belongs to a different analysis than [analysisId], both surface as
 * the same NotFoundError from the service layer (deliberate — see
 * getAIRecommendationById's own documented cross-analysis 404 behavior,
 * mirroring getComplianceDetectionById's, getMissingClauseDetectionById's,
 * and getRiskDetectionById's identical checks) and both become the same
 * 404 response here via handleApiError. This route has no special-case
 * handling for the two cases, by design — same reasoning as Files 123,
 * 115, and 107.
 *
 * Ownership: no requireOwnership() anywhere in this call chain — this
 * is a read, following the established RLS-only-for-reads convention
 * (same as listAIRecommendationsForAnalysis and getAnalysisById
 * itself).
 *
 * No maxDuration export, same reasoning as Files 107, 115, and 123 —
 * a pure read has no long-running AI call to bound, unlike File 130's
 * POST handler.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildAIRecommendationService();
    const aiRecommendation = await service.getAIRecommendationById(
      context.params,
      context.params.analysisId,
      context.params.aiRecommendationId,
    );

    return NextResponse.json({ data: { aiRecommendation } });
  } catch (error) {
    return handleApiError(error);
  }
}