import type { AiLegalInsightResult } from '@/modules/ai-legal-insight/ai-legal-insight.schemas';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';

export type AiLegalInsightStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Mirrors the `ai_legal_insights` table (see migration
 * 20260721000000_ai_legal_insights.sql, File 140, as corrected by
 * Amendment #1 — the originally-included `source_modules` column was
 * dropped after real pasted source showed it was based on a nonexistent
 * precedent; see the Amendment's docstring for the full account). This is
 * the shape returned by BaseRepository<'ai_legal_insights'> — snake_case,
 * matching Postgrest's default column naming, consistent with
 * legal-health-score.entity.ts's (File 134),
 * ai-recommendation.entity.ts's (File 126),
 * compliance-detection.entity.ts's (File 118),
 * missing-clause-detection.entity.ts's (File 110), and
 * risk-detection.entity.ts's (File 102) convention (no camelCase mapping
 * layer anywhere in this project).
 *
 * `status` is typed here as a plain string union rather than re-derived
 * from the database's ai_legal_insight_status enum — same choice every
 * prior entity already made for its own status column, kept consistent
 * here rather than introducing a new pattern for one table.
 *
 * NO promoted scalar columns on this entity, unlike
 * legal-health-score.entity.ts's overall_score / category_scores (File
 * 134). This table's output is narrative text with no natural scalar
 * representation — see File 140's KEY DECISION on deliberately not
 * repeating File 132's promoted-column precedent. This entity's shape is
 * therefore closer to ai-recommendation.entity.ts (File 126) than to
 * legal-health-score.entity.ts (File 134).
 *
 * NO `source_modules` column, per Amendment #1 above. Per-insight
 * provenance (which upstream module(s) each individual insight draws
 * from) lives exclusively inside `result.insights[].sourceModules` (File
 * 141) — there is no table-level provenance field, matching the real
 * ai_recommendations precedent (File 126) rather than the incorrect
 * assumption File 140 originally made.
 *
 * `result` is typed against `AiLegalInsightResult` (File 141), which
 * synthesizes across all six upstream Phase 2 modules plus Document
 * Analysis into plain-language narrative insights rather than reporting
 * new issues directly or producing a composite score. Nothing about that
 * upstream synthesis changes this entity's own shape: it stores exactly
 * one validated JSON result, same as every prior module.
 */
export interface AiLegalInsight {
  id: string;
  document_analysis_id: string;
  status: AiLegalInsightStatus;
  result: AiLegalInsightResult | null;
  provider_used: AIProviderName | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Fields required to create a new AI Legal Insights run. Everything else
 * (status, result, provider_used, error_message, timestamps) is either
 * defaulted by the database or populated later as the run progresses from
 * pending -> processing -> completed/failed — identical lifecycle shape to
 * CreateLegalHealthScoreInput, CreateAIRecommendationInput,
 * CreateComplianceDetectionInput, CreateMissingClauseDetectionInput, and
 * CreateRiskDetectionInput.
 *
 * As with all five, no per-upstream-run reference is accepted here (e.g.
 * no risk_detection_id/missing_clause_detection_id/
 * compliance_detection_id/clause_classification_id/
 * ai_recommendation_id/legal_health_score_id field) — consistent with
 * File 140's KEY DECISION that this module reads each of the six upstream
 * modules' latest-completed rows (plus document_analyses itself) at
 * run-time via their own getLatestCompletedXForAnalysis()-style helpers,
 * rather than the caller pinning specific upstream rows at creation time.
 */
export interface CreateAiLegalInsightInput {
  document_analysis_id: string;
}