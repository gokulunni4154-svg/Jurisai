import type { AIRecommendationResult } from '@/modules/ai-recommendation/ai-recommendation.schemas';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';

export type AIRecommendationStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Mirrors the `ai_recommendations` table (see migration
 * 20260719000000_ai_recommendations.sql, File 124). This is the shape
 * returned by BaseRepository<'ai_recommendations'> — snake_case, matching
 * Postgrest's default column naming, consistent with
 * compliance-detection.entity.ts's (File 118),
 * missing-clause-detection.entity.ts's (File 110), and
 * risk-detection.entity.ts's (File 102) convention (no camelCase mapping
 * layer anywhere in this project).
 *
 * `status` is typed here as a plain string union rather than re-derived
 * from the database's ai_recommendation_status enum — same choice
 * compliance-detection.entity.ts, missing-clause-detection.entity.ts, and
 * risk-detection.entity.ts already made for their own status columns,
 * kept consistent here rather than introducing a new pattern for one
 * table.
 *
 * `result` is typed against `AIRecommendationResult` (File 125), which
 * synthesizes across Clause Classification, Risk Detection, Missing
 * Clause Detection, and Compliance Detection rather than reporting new
 * issues directly — see that file's docstring for the full reasoning.
 * Nothing about that upstream synthesis changes this entity's own shape:
 * it stores exactly one validated JSON result, same as every prior
 * module.
 */
export interface AIRecommendation {
  id: string;
  document_analysis_id: string;
  status: AIRecommendationStatus;
  result: AIRecommendationResult | null;
  provider_used: AIProviderName | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Fields required to create a new AI recommendation run. Everything else
 * (status, result, provider_used, error_message, timestamps) is either
 * defaulted by the database or populated later as the run progresses from
 * pending -> processing -> completed/failed — identical lifecycle shape to
 * CreateComplianceDetectionInput, CreateMissingClauseDetectionInput, and
 * CreateRiskDetectionInput.
 *
 * As with those three, no per-upstream-run reference is accepted here
 * (e.g. no risk_detection_id/missing_clause_detection_id/
 * compliance_detection_id/clause_classification_id field) — consistent
 * with File 124's KEY DECISION that this module reads each upstream
 * module's latest-completed row at run-time via its own
 * getLatestCompletedXForAnalysis()-style helper, rather than the caller
 * pinning specific upstream rows at creation time.
 */
export interface CreateAIRecommendationInput {
  document_analysis_id: string;
}