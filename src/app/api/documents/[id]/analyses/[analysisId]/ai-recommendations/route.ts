// src/app/api/documents/[id]/analyses/[analysisId]/ai-recommendations/route.ts
// File 130 — JurisAI AI Recommendation module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { NotFoundError } from '@/core/errors/app-error';
import { buildAIRecommendationService } from '@/modules/ai-recommendation/ai-recommendation.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 67/69/98,
 * reused unchanged through Files 106, 114, and 122): dynamic route
 * `params` is a plain synchronous object, not a Promise.
 */
interface RouteContext {
  params: { id: string; analysisId: string };
}

/**
 * Same reasoning as Files 67, 98, 106, 114, and 122 — raises this
 * route's execution ceiling from Vercel Hobby's 10s default to its 60s
 * hard maximum. Does not solve the underlying inline-await risk (see
 * KNOWN LIMITATION below); only removes the smaller, unrelated failure
 * mode of the unset default.
 */
export const maxDuration = 60;

/**
 * POST /api/documents/[id]/analyses/[analysisId]/ai-recommendations
 *
 * Diverges from Files 106/114/122's structure in one deliberate way:
 * NO OCR-missing check. Every prior module's route checks
 * buildOcrService().getLatestCompletedExtractionForDocument() first
 * because those services each need raw document text for their own AI
 * call. Per AIRecommendationService's (File 128) own KEY DECISION, this
 * module has no document-text dependency at all — it synthesizes over
 * four upstream RESULTS, not raw text — so that check is correctly
 * absent here, not an oversight.
 *
 * FOUR upstream prerequisite checks instead, one per detection module
 * this route synthesizes over. All four follow File 106's
 * CLASSIFICATION-MISSING reasoning (not its OCR-MISSING reasoning): a
 * valid analysisId with no completed run of a given upstream module is
 * a normal, reachable state — someone may simply not have run that
 * module yet for this analysis — not a data-integrity anomaly. Each
 * missing prerequisite is still surfaced as NotFoundError (a completed
 * run genuinely does not exist yet, from the caller's point of view
 * that IS a 404), but each uses its own distinctly-named resource so a
 * caller can tell which of the four upstream modules is actually
 * missing, rather than one generic message masking which one hasn't
 * run.
 *
 * Check order (classification -> risk -> missing-clause -> compliance)
 * mirrors runAIRecommendation()'s own parameter order (File 128) — no
 * other ordering rationale exists between the four, so declaration
 * order is used as the tiebreaker.
 *
 * KNOWN LIMITATION — inherits File 67/98/106/114/122's Amendment #25
 * reasoning directly: the same Next.js 14.2.15 / Vercel Hobby
 * constraints (no context.waitUntil() in Route Handlers, no after()
 * until Next.js 15.1) apply identically here. runAIRecommendation() is
 * awaited inline, accepted as the same real, bounded risk every prior
 * pipeline route already documents and accepts. Revisit under the same
 * conditions those files list.
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const aiRecommendationService = await buildAIRecommendationService();

    const classification =
      await aiRecommendationService.getLatestCompletedClassificationForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!classification || !classification.result) {
      // See FOUR upstream prerequisite checks above — a normal, expected
      // outcome, not a data-integrity anomaly.
      throw new NotFoundError('clause_classifications', context.params.analysisId);
    }

    const riskDetection = await aiRecommendationService.getLatestCompletedRiskDetectionForAnalysis(
      context.params,
      context.params.analysisId,
    );

    if (!riskDetection || !riskDetection.result) {
      throw new NotFoundError('risk_detections', context.params.analysisId);
    }

    const missingClauseDetection =
      await aiRecommendationService.getLatestCompletedMissingClauseDetectionForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!missingClauseDetection || !missingClauseDetection.result) {
      throw new NotFoundError('missing_clause_detections', context.params.analysisId);
    }

    const complianceDetection =
      await aiRecommendationService.getLatestCompletedComplianceDetectionForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!complianceDetection || !complianceDetection.result) {
      throw new NotFoundError('compliance_detections', context.params.analysisId);
    }

    const aiRecommendation = await aiRecommendationService.createAIRecommendation(
      context.params,
      context.params.analysisId,
    );

    const completedAIRecommendation = await aiRecommendationService.runAIRecommendation(
      aiRecommendation.id,
      classification.result.clauses,
      riskDetection.result.flags,
      missingClauseDetection.result.flags,
      complianceDetection.result.flags,
    );

    return NextResponse.json({ data: completedAIRecommendation }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/ai-recommendations
 *
 * Lists all AI recommendation runs for the given analysis, most recent
 * first (AIRecommendationRepository#findByDocumentAnalysisId's
 * ordering, File 127). No requireOwnership() at this route or in the
 * service — reads follow the established RLS-only-for-reads convention
 * throughout this codebase, identical to Files 106's, 114's, and 122's
 * GET handlers.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const aiRecommendationService = await buildAIRecommendationService();

    const aiRecommendations = await aiRecommendationService.listAIRecommendationsForAnalysis(
      context.params,
      context.params.analysisId,
    );

    return NextResponse.json({ data: aiRecommendations }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}