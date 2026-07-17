// src/app/api/documents/[id]/analyses/[analysisId]/risk-detections/[riskDetectionId]/route.ts
// File 107 — JurisAI Risk Detection module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildRiskDetectionService } from '@/modules/risk-detection/risk-detection.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 51/67/68/69,
 * and reused unchanged through File 99): dynamic route `params` is a
 * plain synchronous object, NOT a Promise. Extended here with the third
 * dynamic segment, `riskDetectionId`.
 */
interface RouteContext {
  params: {
    id: string;
    analysisId: string;
    riskDetectionId: string;
  };
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/risk-detections/[riskDetectionId]
 *
 * Fetches a single Risk Detection run. Thin route — all real logic
 * (parent-analysis visibility check via
 * DocumentAnalysisService#getAnalysisById, called inside
 * RiskDetectionService#getRiskDetectionById, then the
 * document_analysis_id-match check preventing cross-analysis access to
 * a risk detection row) lives in RiskDetectionService#getRiskDetectionById
 * (File 104), matching File 99's identical pattern one layer further
 * down the pipeline.
 *
 * context.params is passed through whole as getRiskDetectionById's
 * rawParams argument — identical to how File 99 passes it to
 * getClassificationById — with analysisId and riskDetectionId
 * additionally extracted for the method's second and third arguments.
 * The route does no parsing or shaping of any identifier itself; that
 * stays inside the service layer.
 *
 * A riskDetectionId that doesn't exist at all, OR that exists but
 * belongs to a different analysis than [analysisId], both surface as
 * the same NotFoundError from the service layer (deliberate — see
 * getRiskDetectionById's own documented cross-analysis 404 behavior,
 * mirroring getClassificationById's identical check) and both become
 * the same 404 response here via handleApiError. This route has no
 * special-case handling for the two cases, by design — same reasoning
 * as File 99.
 *
 * Ownership: no requireOwnership() anywhere in this call chain — this
 * is a read, following the established RLS-only-for-reads convention
 * (same as listRiskDetectionsForAnalysis and getAnalysisById itself).
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildRiskDetectionService();
    const riskDetection = await service.getRiskDetectionById(
      context.params,
      context.params.analysisId,
      context.params.riskDetectionId,
    );

    return NextResponse.json({ data: { riskDetection } });
  } catch (error) {
    return handleApiError(error);
  }
}