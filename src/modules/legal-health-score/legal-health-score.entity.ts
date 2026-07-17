import type { LegalHealthScoreResult, CategoryScores } from '@/modules/legal-health-score/legal-health-score.schemas';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';

export type LegalHealthScoreStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Mirrors the `legal_health_scores` table (see migration
 * 20260720000000_legal_health_scores.sql, File 132). This is the shape
 * returned by BaseRepository<'legal_health_scores'> — snake_case,
 * matching Postgrest's default column naming, consistent with
 * ai-recommendation.entity.ts's (File 126),
 * compliance-detection.entity.ts's (File 118),
 * missing-clause-detection.entity.ts's (File 110), and
 * risk-detection.entity.ts's (File 102) convention (no camelCase mapping
 * layer anywhere in this project).
 *
 * `status` is typed here as a plain string union rather than re-derived
 * from the database's legal_health_score_status enum — same choice every
 * prior entity already made for its own status column, kept consistent
 * here rather than introducing a new pattern for one table.
 *
 * `overall_score` and `category_scores` are the two promoted columns
 * with no precedent in any prior entity (see File 132's KEY DECISIONs on
 * why they exist as first-class columns rather than being buried inside
 * `result`). `overall_score` is a plain nullable integer — no imported
 * type needed. `category_scores` is typed against `CategoryScores`
 * (File 133), the flat four-number shape the Service layer derives from
 * `result.categoryBreakdown` rather than requesting from the model
 * directly — see File 133's docstring for the full reasoning.
 *
 * `result` is typed against `LegalHealthScoreResult` (File 133), which
 * synthesizes across all five upstream modules (Clause Classification,
 * Risk Detection, Missing Clause Detection, Compliance Detection, AI
 * Recommendation Engine) into a single composite assessment rather than
 * reporting new issues directly. Nothing about that upstream synthesis
 * changes this entity's own shape: it stores exactly one validated JSON
 * result, same as every prior module.
 */
export interface LegalHealthScore {
  id: string;
  document_analysis_id: string;
  status: LegalHealthScoreStatus;
  overall_score: number | null;
  category_scores: CategoryScores | null;
  result: LegalHealthScoreResult | null;
  provider_used: AIProviderName | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Fields required to create a new Legal Health Score run. Everything else
 * (status, overall_score, category_scores, result, provider_used,
 * error_message, timestamps) is either defaulted by the database or
 * populated later as the run progresses from pending -> processing ->
 * completed/failed — identical lifecycle shape to
 * CreateAIRecommendationInput, CreateComplianceDetectionInput,
 * CreateMissingClauseDetectionInput, and CreateRiskDetectionInput.
 *
 * As with all four, no per-upstream-run reference is accepted here (e.g.
 * no risk_detection_id/missing_clause_detection_id/
 * compliance_detection_id/clause_classification_id/
 * ai_recommendation_id field) — consistent with File 132's KEY DECISION
 * that this module reads each of the five upstream modules' latest-
 * completed rows at run-time via their own
 * getLatestCompletedXForAnalysis()-style helpers, rather than the caller
 * pinning specific upstream rows at creation time.
 */
export interface CreateLegalHealthScoreInput {
  document_analysis_id: string;
}