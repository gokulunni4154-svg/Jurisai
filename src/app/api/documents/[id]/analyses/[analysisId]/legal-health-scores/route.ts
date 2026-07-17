// src/app/api/documents/[id]/analyses/[analysisId]/legal-health-scores/route.ts
// File 138 — JurisAI Legal Health Score module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { NotFoundError } from '@/core/errors/app-error';
import { buildLegalHealthScoreService } from '@/modules/legal-health-score/legal-health-score.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 67/69/98,
 * reused unchanged through Files 106, 114, 122, and 130): dynamic route
 * `params` is a plain synchronous object, not a Promise.
 */
interface RouteContext {
  params: { id: string; analysisId: string };
}

/**
 * Same reasoning as Files 67, 98, 106, 114, 122, and 130 — raises this
 * route's execution ceiling from Vercel Hobby's 10s default to its 60s
 * hard maximum. Does not solve the underlying inline-await risk (see
 * KNOWN LIMITATION below); only removes the smaller, unrelated failure
 * mode of the unset default.
 */
export const maxDuration = 60;

/**
 * POST /api/documents/[id]/analyses/[analysisId]/legal-health-scores
 *
 * Diverges from Files 106/114/122's structure the same way File 130
 * does: NO OCR-missing check. Per LegalHealthScoreService's (File 136)
 * own KEY DECISION, this module has no document-text dependency at
 * all — it synthesizes over FIVE upstream RESULTS, not raw text — so
 * that check is correctly absent here, same as File 130.
 *
 * FIVE upstream prerequisite checks instead of File 130's four — one
 * per Phase 2 module this route synthesizes over, extending File 130's
 * pattern by the one new upstream module (AI Recommendation Engine)
 * Legal Health Score sits one layer beneath. All five follow File 106's
 * CLASSIFICATION-MISSING reasoning (not its OCR-MISSING reasoning): a
 * valid analysisId with no completed run of a given upstream module is
 * a normal, reachable state, not a data-integrity anomaly. Each missing
 * prerequisite is still surfaced as NotFoundError, each using its own
 * distinctly-named resource so a caller can tell which of the five
 * upstream modules is actually missing, rather than one generic
 * message masking which one hasn't run.
 *
 * Check order (classification -> risk -> missing-clause -> compliance
 * -> ai-recommendation) mirrors runLegalHealthScore()'s own parameter
 * order (File 136), which itself mirrors File 136's
 * getLatestCompletedXForAnalysis() passthrough declaration order — same
 * tiebreaker rationale as File 130, extended by the one new upstream
 * check appended last, matching where AIRecommendationService sits last
 * in File 136's own constructor argument list.
 *
 * KNOWN LIMITATION — inherits File 67/98/106/114/122/130's Amendment
 * #25 reasoning directly: the same Next.js 14.2.15 / Vercel Hobby
 * constraints (no context.waitUntil() in Route Handlers, no after()
 * until Next.js 15.1) apply identically here. runLegalHealthScore() is
 * awaited inline, accepted as the same real, bounded risk every prior
 * pipeline route already documents and accepts — now the largest single
 * inline AI call in the pipeline, synthesizing over five upstream
 * results rather than four. Revisit under the same conditions those
 * files list.
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const legalHealthScoreService = await buildLegalHealthScoreService();

    const classification =
      await legalHealthScoreService.getLatestCompletedClassificationForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!classification || !classification.result) {
      // See FIVE upstream prerequisite checks above — a normal,
      // expected outcome, not a data-integrity anomaly.
      throw new NotFoundError('clause_classifications', context.params.analysisId);
    }

    const riskDetection =
      await legalHealthScoreService.getLatestCompletedRiskDetectionForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!riskDetection || !riskDetection.result) {
      throw new NotFoundError('risk_detections', context.params.analysisId);
    }

    const missingClauseDetection =
      await legalHealthScoreService.getLatestCompletedMissingClauseDetectionForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!missingClauseDetection || !missingClauseDetection.result) {
      throw new NotFoundError('missing_clause_detections', context.params.analysisId);
    }

    const complianceDetection =
      await legalHealthScoreService.getLatestCompletedComplianceDetectionForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!complianceDetection || !complianceDetection.result) {
      throw new NotFoundError('compliance_detections', context.params.analysisId);
    }

    const aiRecommendation =
      await legalHealthScoreService.getLatestCompletedAIRecommendationForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!aiRecommendation || !aiRecommendation.result) {
      throw new NotFoundError('ai_recommendations', context.params.analysisId);
    }

    const legalHealthScore = await legalHealthScoreService.createLegalHealthScore(
      context.params,
      context.params.analysisId,
    );

    const completedLegalHealthScore = await legalHealthScoreService.runLegalHealthScore(
      legalHealthScore.id,
      classification.result.clauses,
      riskDetection.result.flags,
      missingClauseDetection.result.flags,
      complianceDetection.result.flags,
      aiRecommendation.result.recommendations,
    );

    return NextResponse.json({ data: completedLegalHealthScore }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/legal-health-scores
 *
 * Lists all legal health score runs for the given analysis, most recent
 * first (LegalHealthScoreRepository#findByDocumentAnalysisId's ordering,
 * File 135). No requireOwnership() at this route or in the service —
 * reads follow the established RLS-only-for-reads convention throughout
 * this codebase, identical to Files 106's, 114's, 122's, and 130's GET
 * handlers.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const legalHealthScoreService = await buildLegalHealthScoreService();

    const legalHealthScores = await legalHealthScoreService.listLegalHealthScoresForAnalysis(
      context.params,
      context.params.analysisId,
    );

    return NextResponse.json({ data: legalHealthScores }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}