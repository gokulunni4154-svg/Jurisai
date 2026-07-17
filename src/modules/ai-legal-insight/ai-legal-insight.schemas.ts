import { z } from 'zod';

/**
 * Zod schema describing the structured output of AI Legal Insights.
 * Passed as `AIGenerationRequest.schema` (ai-provider.interface.ts,
 * File 58) — the model is constrained to return exactly this shape.
 * Follows risk-detection.schemas.ts (File 101),
 * missing-clause-detection.schemas.ts (File 109),
 * compliance-detection.schemas.ts (File 117),
 * ai-recommendation.schemas.ts (File 125), and
 * legal-health-score.schemas.ts (File 133) directly: `.describe()` calls
 * are kept concrete and instructive, since they become part of the JSON
 * Schema sent to both providers and materially affect output quality.
 *
 * KEY DECISION — this module's inputs are ALL SIX completed upstream
 * Phase 2 modules plus Document Analysis for a given analysis (Clause
 * Classification, Risk Detection, Missing Clause Detection, Compliance
 * Detection, AI Recommendation Engine, Legal Health Score Engine),
 * confirmed when File 140's migration was scoped. Unlike every prior
 * module, this one produces neither a list of discrete issues (Files
 * 92-131) nor a composite score (File 132-139) — it produces narrative
 * synthesis explaining the patterns connecting upstream outputs, in
 * plain language a non-lawyer can read as a coherent explanation.
 *
 * KEY DECISION — `AiLegalInsightSourceModule` extends File 125's
 * `SourceModule` enum from four values to seven, adding
 * `ai_recommendation`, `legal_health_score`, and `document_analysis`.
 * Same purpose as File 125's original: which upstream module(s) a given
 * insight was synthesized from, still an array since a single insight
 * may legitimately draw from multiple sources at once.
 *
 * KEY DECISION, DELIBERATE NON-ADOPTION OF FILE 133'S NEWEST PRECEDENT —
 * no closed `InsightTheme` enum. File 133's `LegalHealthCategory` is a
 * closed, exhaustive 4-value enum because File 132's scoping confirmed
 * exactly four sub-scores *before* that schema was drafted, and
 * `categoryBreakdown` was validated via `superRefine` to require exactly
 * one entry per category. AI Legal Insights' scoping never confirmed a
 * fixed theme taxonomy — narrative patterns are expected to vary per
 * document (a lease's cross-module story is not shaped like an NDA's),
 * so inventing a closed enum here would assert structure that was never
 * confirmed with the user. Instead, each insight carries a free-text
 * `title`, following `recommendationSchema.title`'s precedent (File 125)
 * rather than `categoryScoreDetailSchema.category`'s (File 133). This is
 * a considered fork from the most recent schema's pattern, not an
 * inconsistency — see File 141's chat explanation for the full
 * reasoning.
 *
 * KEY DECISION, DIRECT CONSEQUENCE OF THE ABOVE — the `insights` array
 * has no `.length()` constraint and no `superRefine` exhaustiveness
 * check. Follows `aiRecommendationResultSchema.recommendations` (File
 * 125, open-ended count) rather than
 * `legalHealthScoreResultSchema.categoryBreakdown` (File 133, fixed
 * count of 4) — there is no fixed category set here to validate
 * completeness against.
 *
 * CONSTRAINT, carried forward from File 125 at larger scale — NOT YET
 * AVAILABLE: a structured, ID-based back-reference from an insight to
 * the specific upstream flag(s)/recommendation(s)/score(s) it was
 * synthesized from. None of the seven upstream schemas carry a stable
 * `id` field usable here. `sourceSummary` remains a deliberate,
 * human-readable workaround, not a structured link — same open item as
 * File 125's, now spanning seven possible sources instead of four.
 *
 * KEY DECISION — `confidence` retained, same downstream purpose as
 * every upstream schema: low-confidence insights are expected to be
 * surfaced distinctly (e.g. for human review) rather than presented
 * with the same authority as high-confidence ones.
 *
 * KEY DECISION — no top-level summary/score/theme-count field on
 * `aiLegalInsightResultSchema`. Same module-boundary discipline as
 * every prior schema's identical omission — aggregate scoring is Legal
 * Health Score Engine's responsibility (File 133), not this module's.
 */

export const AiLegalInsightSourceModule = z.enum([
  'clause_classification',
  'risk_detection',
  'missing_clause_detection',
  'compliance_detection',
  'ai_recommendation',
  'legal_health_score',
  'document_analysis',
]);
export type AiLegalInsightSourceModule = z.infer<typeof AiLegalInsightSourceModule>;

const insightSchema = z.object({
  title: z
    .string()
    .describe(
      'A short, plain-language label for this insight (e.g. "Termination clause risk compounds a missing-clause gap"), suitable for display as a list item without the full narrative. Free text, not a fixed category — insight themes are expected to vary by document rather than fit a closed taxonomy.',
    ),
  narrative: z
    .string()
    .describe(
      'The plain-language synthesis itself, written for someone without a legal background. Should explain the *story* connecting two or more upstream findings — what pattern, compounding effect, or relationship exists across modules that is not visible from any single upstream output alone (e.g. "this document\'s risk concentration in the termination clause (Risk Detection) is compounded by the same clause being flagged missing from the standard set (Missing Clause Detection), which is why the Health Score\'s negotiation-leverage sub-score is low"). This is the field that distinguishes this module from AI Recommendation Engine (actionable steps) and Legal Health Score Engine (a number) — narrative explanation, not an instruction or a score.',
    ),
  sourceModules: z
    .array(AiLegalInsightSourceModule)
    .min(1)
    .describe(
      'Which upstream module(s) this insight was synthesized from. May include more than one module when the insight\'s value comes specifically from connecting findings across modules (e.g. ["risk_detection", "missing_clause_detection", "legal_health_score"]).',
    ),
  sourceSummary: z
    .string()
    .describe(
      'A brief, human-readable description of the specific upstream finding(s) this insight draws from (e.g. "Risk Detection\'s hidden_liability flag on the termination clause; Missing Clause Detection\'s missing-termination-clause flag on the same document"). Not a structured reference — the upstream schemas have no stable ID to reference directly, so this is a descriptive trace only.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'The model\'s confidence that this insight is genuinely warranted and correctly synthesized from its source findings, from 0 (uncertain) to 1 (certain). Same downstream purpose as every upstream schema\'s identical field: low-confidence insights are expected to be surfaced distinctly (e.g. for human review) rather than presented with the same authority as high-confidence ones.',
    ),
});
export type AiLegalInsight = z.infer<typeof insightSchema>;

/**
 * The complete structured result of one AI Legal Insights run. Top-level
 * schema passed to the AI Provider Layer's generateStructured() call,
 * and what gets stored, once validated, in ai_legal_insights.result
 * (see the File 140 migration).
 */
export const aiLegalInsightResultSchema = z.object({
  insights: z
    .array(insightSchema)
    .describe(
      'Every distinct narrative insight synthesized across the six upstream Phase 2 modules and Document Analysis for this analysis. Each insight should connect two or more upstream findings into a plain-language explanation a non-lawyer can follow — this module\'s value is cross-module narrative synthesis, not restating any single upstream flag, recommendation, or score on its own.',
    ),
});

export type AiLegalInsightResult = z.infer<typeof aiLegalInsightResultSchema>;