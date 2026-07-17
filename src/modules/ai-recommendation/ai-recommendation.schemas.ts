import { z } from 'zod';

/**
 * Zod schema describing the structured output of the AI Recommendation
 * Engine. Passed as `AIGenerationRequest.schema` (ai-provider.interface.ts,
 * File 58) — the model is constrained to return exactly this shape.
 * Follows risk-detection.schemas.ts (File 101),
 * missing-clause-detection.schemas.ts (File 109), and
 * compliance-detection.schemas.ts (File 117) directly: `.describe()`
 * calls are kept concrete and instructive (they become part of the JSON
 * Schema sent to both providers and materially affect output quality).
 *
 * KEY DECISION — this module's inputs are ALL FOUR completed detection
 * modules for a given analysis (Clause Classification, Risk Detection,
 * Missing Clause Detection, Compliance Detection), confirmed when File
 * 124's migration was scoped. Unlike every prior module, this one does
 * not primarily report new issues found directly in the document — it
 * synthesizes across what the four upstream modules already reported,
 * prioritizing and consolidating into actionable next steps for the
 * document owner.
 *
 * KEY DECISION — recommendations are SYNTHESIZED, not a 1:1 mirror of
 * upstream flags. A recommendation engine that just relabels each
 * upstream flag one-for-one adds no value over the four modules that
 * already list them individually. `sourceModules` is therefore an
 * ARRAY, not a single discriminator — a single recommendation may
 * legitimately draw from more than one upstream module at once (e.g. a
 * Risk Detection "hidden_liability" flag and a Compliance Detection
 * "non_compliant_clause" flag both concerning the same clause collapse
 * into one recommendation rather than two).
 *
 * CONSTRAINT, flagged explicitly rather than silently worked around —
 * NOT YET AVAILABLE: a structured, ID-based back-reference from a
 * recommendation to the specific upstream flag(s) it was generated
 * from. None of the three pasted upstream flag schemas
 * (riskFlagSchema, missingClauseFlagSchema, complianceFlagSchema) carry
 * a stable `id` field, and File 124's migration deliberately has no
 * per-upstream-run FK (see its KEY DECISION on document_analysis_id-only
 * anchoring). There is therefore nothing to reference by ID. The
 * `sourceSummary` field below is a deliberate, human-readable
 * workaround — not a structured link. If flag-level IDs are added to
 * the four upstream schemas in a future amendment, this schema should
 * be revisited to use them instead.
 *
 * KEY DECISION — a fresh `RecommendationPriority` enum, not a reuse of
 * `RiskSeverity`, `MissingClauseImportance`, or `ComplianceSeverity`.
 * Continuing the same discipline all three upstream schemas already
 * established: severity/priority-shaped vocabulary is never cross-module
 * shared in this project, even when the four allowed values are
 * identical in shape every time.
 *
 * KEY DECISION — a new `RecommendationActionType` enum. None of the
 * three upstream modules needed this because they each report *issues*
 * found in the document. This module reports *actions* the document
 * owner should take in response to those issues — a genuinely new
 * concept at this layer of the pipeline, not inherited from precedent.
 *
 * KEY DECISION — no top-level summary/score field (e.g.
 * `overallRecommendationCount` or a priority-weighted total) on
 * `aiRecommendationResultSchema`. Same module-boundary discipline as
 * every upstream schema's identical omission — aggregate scoring is the
 * Legal Health Score Engine's future responsibility, not this module's.
 */

export const SourceModule = z.enum([
  'clause_classification',
  'risk_detection',
  'missing_clause_detection',
  'compliance_detection',
]);
export type SourceModule = z.infer<typeof SourceModule>;

export const RecommendationPriority = z.enum(['low', 'medium', 'high', 'critical']);
export type RecommendationPriority = z.infer<typeof RecommendationPriority>;

export const RecommendationActionType = z.enum([
  'add_clause',
  'amend_clause',
  'remove_clause',
  'compliance_action',
  'negotiate_terms',
  'seek_professional_review',
]);
export type RecommendationActionType = z.infer<typeof RecommendationActionType>;

const recommendationSchema = z.object({
  actionType: RecommendationActionType.describe(
    'The kind of action this recommendation asks the document owner to take. Use "add_clause" for a missing element that should be added, "amend_clause" for existing language that should be changed, "remove_clause" for language that should be struck, "compliance_action" for a non-clause administrative step (e.g. stamping, registration), "negotiate_terms" for a one-sided or unfavorable term that should be renegotiated with the counterparty, and "seek_professional_review" only when the issue genuinely requires a lawyer\'s judgment rather than a self-service edit.',
  ),
  priority: RecommendationPriority.describe(
    'How urgently this recommendation should be acted on. "critical" should be reserved for recommendations addressing real legal or financial exposure (e.g. an illegal or unstamped clause, an uncapped liability), not simply "the most pressing item in an otherwise low-priority document" — priority is meant to be comparable across documents, not curved per document.',
  ),
  title: z
    .string()
    .describe(
      'A short, plain-language summary of the recommended action (e.g. "Add a termination clause" or "Cap the indemnity liability"), suitable for display as a list item without the full explanation.',
    ),
  recommendation: z
    .string()
    .describe(
      'The specific, actionable recommendation itself, written for someone without a legal background — what to change, add, or do, stated concretely enough to act on rather than a vague restatement of the underlying issue.',
    ),
  rationale: z
    .string()
    .describe(
      'Why this recommendation matters — the risk, gap, or compliance exposure it addresses, and what synthesizing across the source module(s) revealed that any single upstream flag did not on its own (e.g. "this clause is both one-sided AND non-compliant with the DPDP Act, so amending it also resolves the compliance issue").',
    ),
  sourceModules: z
    .array(SourceModule)
    .min(1)
    .describe(
      'Which upstream detection module(s) this recommendation was synthesized from. May include more than one module when a single recommendation resolves issues reported by multiple modules at once (e.g. ["risk_detection", "compliance_detection"]).',
    ),
  sourceSummary: z
    .string()
    .describe(
      'A brief, human-readable description of the specific upstream flag(s) this recommendation draws from (e.g. "Risk Detection\'s hidden_liability flag on the indemnity clause; Compliance Detection\'s non_compliant_clause flag on the same clause under the DPDP Act"). Not a structured reference — the upstream flag schemas have no stable ID to reference directly, so this is a descriptive trace only.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'The model\'s confidence that this recommendation is genuinely warranted and correctly synthesized from its source flags, from 0 (uncertain) to 1 (certain). Same downstream purpose as every upstream schema\'s identical field: low-confidence recommendations are expected to be surfaced distinctly (e.g. for human review) rather than presented with the same authority as high-confidence ones.',
    ),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

/**
 * The complete structured result of one AI recommendation run. Top-level
 * schema passed to the AI Provider Layer's generateStructured() call,
 * and what gets stored, once validated, in ai_recommendations.result
 * (see the File 124 migration).
 */
export const aiRecommendationResultSchema = z.object({
  recommendations: z
    .array(recommendationSchema)
    .describe(
      'Every distinct, actionable recommendation synthesized from the four upstream detection modules for this analysis. This should consolidate overlapping or related upstream flags into single recommendations where genuinely warranted, not simply restate every upstream flag as its own recommendation — the value of this module is prioritized synthesis, not duplication.',
    ),
});

export type AIRecommendationResult = z.infer<typeof aiRecommendationResultSchema>;