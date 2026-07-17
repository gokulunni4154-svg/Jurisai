// src/app/api/documents/[id]/analyses/[analysisId]/compliance-detections/[complianceDetectionId]/route.ts
// File 123 — JurisAI Compliance Detection module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildComplianceDetectionService } from '@/modules/compliance-detection/compliance-detection.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 51/67/68/69,
 * reused unchanged through Files 107 and 115): dynamic route `params` is
 * a plain synchronous object, NOT a Promise. Extended here with the
 * third dynamic segment, `complianceDetectionId`.
 */
interface RouteContext {
  params: {
    id: string;
    analysisId: string;
    complianceDetectionId: string;
  };
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/compliance-detections/[complianceDetectionId]
 *
 * Fetches a single Compliance Detection run. Thin route — all real
 * logic (parent-analysis visibility check via
 * DocumentAnalysisService#getAnalysisById, called inside
 * ComplianceDetectionService#getComplianceDetectionById, then the
 * document_analysis_id-match check preventing cross-analysis access to
 * a compliance detection row) lives in
 * ComplianceDetectionService#getComplianceDetectionById (File 120),
 * matching File 115's and File 107's identical pattern at the same
 * pipeline depth.
 *
 * context.params is passed through whole as
 * getComplianceDetectionById's rawParams argument — identical to how
 * File 115 passes it to getMissingClauseDetectionById and File 107
 * passes it to getRiskDetectionById — with analysisId and
 * complianceDetectionId additionally extracted for the method's second
 * and third arguments. The route does no parsing or shaping of any
 * identifier itself; that stays inside the service layer.
 *
 * A complianceDetectionId that doesn't exist at all, OR that exists but
 * belongs to a different analysis than [analysisId], both surface as
 * the same NotFoundError from the service layer (deliberate — see
 * getComplianceDetectionById's own documented cross-analysis 404
 * behavior, mirroring getMissingClauseDetectionById's and
 * getRiskDetectionById's identical checks) and both become the same 404
 * response here via handleApiError. This route has no special-case
 * handling for the two cases, by design — same reasoning as Files 115
 * and 107.
 *
 * Ownership: no requireOwnership() anywhere in this call chain — this
 * is a read, following the established RLS-only-for-reads convention
 * (same as listComplianceDetectionsForAnalysis and getAnalysisById
 * itself).
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildComplianceDetectionService();
    const complianceDetection = await service.getComplianceDetectionById(
      context.params,
      context.params.analysisId,
      context.params.complianceDetectionId,
    );

    return NextResponse.json({ data: { complianceDetection } });
  } catch (error) {
    return handleApiError(error);
  }
}