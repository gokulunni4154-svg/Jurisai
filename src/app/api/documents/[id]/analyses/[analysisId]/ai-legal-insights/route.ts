// src/app/api/documents/[id]/analyses/[analysisId]/ai-legal-insights/route.ts
// File 146 — JurisAI AI Legal Insight module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { NotFoundError } from '@/core/errors/app-error';
import { buildAiLegalInsightService } from '@/modules/ai-legal-insight/ai-legal-insight.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 67/69/98,
 * reused unchanged through Files 106, 114, 122, 130, and 138): dynamic
 * route `params` is a plain synchronous object, not a Promise.
 */
interface RouteContext {
  params: { id: string; analysisId: string };
}

/**
 * Same reasoning as Files 67, 98, 106, 114, 122, 130, and 138 — raises
 * this route's execution ceiling from Vercel Hobby's 10s default to its
 * 60s hard maximum. Does not solve the underlying inline-await risk (see
 * KNOWN LIMITATION below); only removes the smaller, unrelated failure
 * mode of the unset default.
 */
export const maxDuration = 60;

/**
 * POST /api/documents/[id]/analyses/[analysisId]/ai-legal-insights
 *
 * Diverges from Files 106/114/122's structure the same way Files 130 and
 * 138 do: NO OCR-missing check. Per AiLegalInsightService's (File 145)
 * own KEY DECISION, this module has no document-text dependency at all
 * — it synthesizes over SIX upstream RESULTS, not raw text — so that
 * check is correctly absent here, same as Files 130 and 138.
 *
 * SIX upstream prerequisite checks instead of File 138's five — one per
 * Phase 2 module this route synthesizes over, extending File 138's
 * pattern by the one new upstream module (Legal Health Score Engine) AI
 * Legal Insights sits one layer beneath. All six follow File 106's
 * CLASSIFICATION-MISSING reasoning (not its OCR-MISSING reasoning): a
 * valid analysisId with no completed run of a given upstream module is
 * a normal, reachable state, not a data-integrity anomaly. Each missing
 * prerequisite is still surfaced as NotFoundError, each using its own
 * distinctly-named resource so a caller can tell which of the six
 * upstream modules is actually missing, rather than one generic message
 * masking which one hasn't run.
 *
 * Check order (classification -> risk -> missing-clause -> compliance ->
 * ai-recommendation -> legal-health-score) mirrors runAiLegalInsight()'s
 * own parameter order (File 145), which itself mirrors File 145's
 * getLatestCompletedXForAnalysis() passthrough declaration order — same
 * tiebreaker rationale as Files 130 and 138, extended by the one new
 * upstream check appended last, matching where LegalHealthScoreService
 * sits last in File 145's own constructor argument list.
 *
 * KNOWN LIMITATION — inherits File 67/98/106/114/122/130/138's Amendment
 * #25 reasoning directly: the same Next.js 14.2.15 / Vercel Hobby
 * constraints (no context.waitUntil() in Route Handlers, no after()
 * until Next.js 15.1) apply identically here. runAiLegalInsight() is
 * awaited inline, accepted as the same real, bounded risk every prior
 * pipeline route already documents and accepts — now the largest single
 * inline AI call in the pipeline, synthesizing over six upstream results
 * rather than five. Revisit under the same conditions those files list.
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const aiLegalInsightService = await buildAiLegalInsightService();

    const classification =
      await aiLegalInsightService.getLatestCompletedClassificationForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!classification || !classification.result) {
      // See SIX upstream prerequisite checks above — a normal, expected
      // outcome, not a data-integrity anomaly.
      throw new NotFoundError('clause_classifications', context.params.analysisId);
    }

    const riskDetection =
      await aiLegalInsightService.getLatestCompletedRiskDetectionForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!riskDetection || !riskDetection.result) {
      throw new NotFoundError('risk_detections', context.params.analysisId);
    }

    const missingClauseDetection =
      await aiLegalInsightService.getLatestCompletedMissingClauseDetectionForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!missingClauseDetection || !missingClauseDetection.result) {
      throw new NotFoundError('missing_clause_detections', context.params.analysisId);
    }

    const complianceDetection =
      await aiLegalInsightService.getLatestCompletedComplianceDetectionForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!complianceDetection || !complianceDetection.result) {
      throw new NotFoundError('compliance_detections', context.params.analysisId);
    }

    const aiRecommendation =
      await aiLegalInsightService.getLatestCompletedAIRecommendationForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!aiRecommendation || !aiRecommendation.result) {
      throw new NotFoundError('ai_recommendations', context.params.analysisId);
    }

    const legalHealthScore =
      await aiLegalInsightService.getLatestCompletedLegalHealthScoreForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!legalHealthScore || !legalHealthScore.result) {
      throw new NotFoundError('legal_health_scores', context.params.analysisId);
    }

    const aiLegalInsight = await aiLegalInsightService.createAiLegalInsight(
      context.params,
      context.params.analysisId,
    );

    const completedAiLegalInsight = await aiLegalInsightService.runAiLegalInsight(
      aiLegalInsight.id,
      classification.result.clauses,
      riskDetection.result.flags,
      missingClauseDetection.result.flags,
      complianceDetection.result.flags,
      aiRecommendation.result.recommendations,
      legalHealthScore.result,
    );

    return NextResponse.json({ data: completedAiLegalInsight }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/ai-legal-insights
 *
 * Lists all AI Legal Insight runs for the given analysis, most recent
 * first (AiLegalInsightRepository#findByDocumentAnalysisId's ordering,
 * File 143). No requireOwnership() at this route or in the service —
 * reads follow the established RLS-only-for-reads convention throughout
 * this codebase, identical to Files 106's, 114's, 122's, 130's, and
 * 138's GET handlers.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const aiLegalInsightService = await buildAiLegalInsightService();

    const aiLegalInsights = await aiLegalInsightService.listAiLegalInsightsForAnalysis(
      context.params,
      context.params.analysisId,
    );

    return NextResponse.json({ data: aiLegalInsights }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}