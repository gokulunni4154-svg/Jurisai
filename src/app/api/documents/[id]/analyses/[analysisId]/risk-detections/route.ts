// src/app/api/documents/[id]/analyses/[analysisId]/risk-detections/route.ts
// File 106 — JurisAI Risk Detection module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { NotFoundError } from '@/core/errors/app-error';
import { buildOcrService } from '@/modules/ocr/ocr.factory';
import { buildRiskDetectionService } from '@/modules/risk-detection/risk-detection.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 67/69/98):
 * dynamic route `params` is a plain synchronous object, not a Promise.
 */
interface RouteContext {
  params: { id: string; analysisId: string };
}

/**
 * Same reasoning as Files 67 and 98 — raises this route's execution
 * ceiling from Vercel Hobby's 10s default to its 60s hard maximum. Does
 * not solve the underlying inline-await risk (see KNOWN LIMITATION
 * below); only removes the smaller, unrelated failure mode of the unset
 * default.
 */
export const maxDuration = 60;

/**
 * POST /api/documents/[id]/analyses/[analysisId]/risk-detections
 *
 * Mirrors File 98's structure one module further down the pipeline, but
 * this route has TWO upstream prerequisites to check before it can run,
 * not one — the completed OCR extraction (documentText) AND the latest
 * completed Clause Classification (classifiedClauses), per
 * RiskDetectionService's (File 104) own KEY DECISION.
 *
 * OCR-MISSING CHECK — identical reasoning to File 98, not re-derived:
 * reaching this route requires a real, resolvable analysisId, which
 * DocumentAnalysisService.getAnalysisById() (called inside
 * createRiskDetection()) already confirms belongs to this document. An
 * analysis can only exist after runAnalysis() succeeded (File 67), which
 * itself required a completed extraction — so a missing completed
 * extraction here indicates a genuine data inconsistency, exactly as
 * File 98 reasons, not a normal branch. Surfaced as NotFoundError.
 *
 * CLASSIFICATION-MISSING CHECK — this is NOT the same situation as the
 * OCR case above, and is not treated identically by default. Clause
 * Classification is triggered by its own independent route (File 98),
 * with no construction-level guarantee tying it to Document Analysis
 * completing. A valid analysisId with zero completed classification
 * runs is an entirely normal, reachable state — someone may simply not
 * have run classification yet for this analysis. This is reasoned the
 * same way File 67 reasons about its own OCR-failure branch: a real,
 * expected outcome, not a bug. Still surfaced as NotFoundError (a
 * completed classification genuinely does not exist yet, from the
 * caller's point of view that IS a 404), but on different grounds than
 * the OCR check directly above it.
 *
 * KNOWN LIMITATION — inherits File 67/98's Amendment #25 reasoning
 * directly: the same Next.js 14.2.15 / Vercel Hobby constraints (no
 * context.waitUntil() in Route Handlers, no after() until Next.js 15.1)
 * apply identically here. runRiskDetection() is awaited inline, accepted
 * as the same real, bounded risk Files 67 and 98 already document and
 * accept. Revisit under the same conditions those files list.
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const ocrService = await buildOcrService();
    const riskDetectionService = await buildRiskDetectionService();

    const extraction = await ocrService.getLatestCompletedExtractionForDocument(context.params);

    if (!extraction || !extraction.result) {
      // See OCR-MISSING CHECK above — expected to be unreachable given a
      // valid analysisId already implies a completed extraction existed.
      throw new NotFoundError('ocr_extractions', context.params.id);
    }

    const classification = await riskDetectionService.getLatestCompletedClassificationForAnalysis(
      context.params,
      context.params.analysisId,
    );

    if (!classification || !classification.result) {
      // See CLASSIFICATION-MISSING CHECK above — unlike the OCR case,
      // this is a normal, expected outcome: classification simply
      // hasn't completed for this analysis yet.
      throw new NotFoundError('clause_classifications', context.params.analysisId);
    }

    const riskDetection = await riskDetectionService.createRiskDetection(
      context.params,
      context.params.analysisId,
    );

    const completedRiskDetection = await riskDetectionService.runRiskDetection(
      riskDetection.id,
      extraction.result.text,
      classification.result.clauses,
    );

    return NextResponse.json({ data: completedRiskDetection }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/risk-detections
 *
 * Lists all risk detection runs for the given analysis, most recent
 * first (RiskDetectionRepository#findByDocumentAnalysisId's ordering,
 * File 103). No requireOwnership() at this route or in the service —
 * reads follow the established RLS-only-for-reads convention throughout
 * this codebase, identical to File 98's GET handler.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const riskDetectionService = await buildRiskDetectionService();

    const riskDetections = await riskDetectionService.listRiskDetectionsForAnalysis(
      context.params,
      context.params.analysisId,
    );

    return NextResponse.json({ data: riskDetections }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}