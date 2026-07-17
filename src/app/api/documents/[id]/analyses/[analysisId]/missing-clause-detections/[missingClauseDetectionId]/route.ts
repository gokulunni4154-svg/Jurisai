// src/app/api/documents/[id]/analyses/[analysisId]/missing-clause-detections/[missingClauseDetectionId]/route.ts
// File 115 — JurisAI Missing Clause Detection module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildMissingClauseDetectionService } from '@/modules/missing-clause-detection/missing-clause-detection.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 51/67/68/69,
 * reused unchanged through File 107): dynamic route `params` is a plain
 * synchronous object, NOT a Promise. Extended here with the third
 * dynamic segment, `missingClauseDetectionId`.
 */
interface RouteContext {
  params: {
    id: string;
    analysisId: string;
    missingClauseDetectionId: string;
  };
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/missing-clause-detections/[missingClauseDetectionId]
 *
 * Fetches a single Missing Clause Detection run. Thin route — all real
 * logic (parent-analysis visibility check via
 * DocumentAnalysisService#getAnalysisById, called inside
 * MissingClauseDetectionService#getMissingClauseDetectionById, then the
 * document_analysis_id-match check preventing cross-analysis access to
 * a missing clause detection row) lives in
 * MissingClauseDetectionService#getMissingClauseDetectionById (File
 * 112), matching File 107's identical pattern one module over.
 *
 * context.params is passed through whole as
 * getMissingClauseDetectionById's rawParams argument — identical to how
 * File 107 passes it to getRiskDetectionById — with analysisId and
 * missingClauseDetectionId additionally extracted for the method's
 * second and third arguments. The route does no parsing or shaping of
 * any identifier itself; that stays inside the service layer.
 *
 * A missingClauseDetectionId that doesn't exist at all, OR that exists
 * but belongs to a different analysis than [analysisId], both surface
 * as the same NotFoundError from the service layer (deliberate — see
 * getMissingClauseDetectionById's own documented cross-analysis 404
 * behavior, mirroring getRiskDetectionById's identical check) and both
 * become the same 404 response here via handleApiError. This route has
 * no special-case handling for the two cases, by design — same
 * reasoning as File 107.
 *
 * Ownership: no requireOwnership() anywhere in this call chain — this
 * is a read, following the established RLS-only-for-reads convention
 * (same as listMissingClauseDetectionsForAnalysis and getAnalysisById
 * itself).
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildMissingClauseDetectionService();
    const missingClauseDetection = await service.getMissingClauseDetectionById(
      context.params,
      context.params.analysisId,
      context.params.missingClauseDetectionId,
    );

    return NextResponse.json({ data: { missingClauseDetection } });
  } catch (error) {
    return handleApiError(error);
  }
}