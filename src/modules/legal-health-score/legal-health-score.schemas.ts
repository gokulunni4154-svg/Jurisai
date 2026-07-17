import { z } from 'zod';

/**
 * Zod schema describing the structured output of the Legal Health Score
 * Engine. Passed as `AIGenerationRequest.schema` (ai-provider.interface.ts,
 * File 58) — the model is constrained to return exactly this shape.
 * Follows risk-detection.schemas.ts (File 101),
 * missing-clause-detection.schemas.ts (File 109),
 * compliance-detection.schemas.ts (File 117), and
 * ai-recommendation.schemas.ts (File 125) directly: `.describe()` calls
 * are kept concrete and instructive, since they become part of the JSON
 * Schema sent to both providers and materially affect output quality.
 *
 * KEY DECISION — this module's inputs are ALL FIVE completed upstream
 * modules for a given analysis (Clause Classification, Risk Detection,
 * Missing Clause Detection, Compliance Detection, AI Recommendation
 * Engine), confirmed when File 132's migration was scoped. Unlike every
 * prior module, this one does not report discrete issues at all — it
 * produces a single composite health assessment synthesized across all
 * five upstream outputs.
 *
 * KEY DECISION — a new `LegalHealthCategory` enum, not a reuse of
 * `RiskSeverity`, `MissingClauseImportance`, `ComplianceSeverity`, or
 * `RecommendationPriority`. Continues the same discipline every upstream
 * schema already established (see File 125's docstring on
 * `RecommendationPriority`): severity/priority/category-shaped vocabulary
 * is never cross-module shared in this project. Four fixed values —
 * `risk`, `compliance`, `completeness`, `negotiation_leverage` — matching
 * File 132's confirmed four sub-scores exactly.
 *
 * KEY DECISION — the model produces ONE shape, `categoryBreakdown`, not
 * two. File 132's migration has both a promoted `category_scores` column
 * (flat `{risk, compliance, completeness, negotiationLeverage}` numbers)
 * and a fuller `result` column. Asking the model to emit both a flat
 * score object AND a detailed breakdown risks the two disagreeing with
 * each other. Instead, the model emits only `categoryBreakdown` (one
 * detailed entry per category, each carrying its own score), and the
 * not-yet-built Service layer derives the flat `categoryScores` object
 * for the promoted column by mapping over `categoryBreakdown` — a single
 * source of truth from the model, one deterministic derivation
 * downstream, rather than two independent model outputs to keep in sync.
 *
 * OPEN ITEM, flagged explicitly rather than silently settled — whether
 * `overallScore` should be model-generated at all. File 132's migration
 * comment states `overall_score` duplicates `result.overallScore`,
 * implying the model produces it directly; this schema is built against
 * that stated design. However, LLMs are not reliably consistent at
 * weighted arithmetic across runs, and `overall_score` is specifically
 * the column promoted for cross-document comparison and threshold
 * alerting (File 132's KEY DECISION) — precisely the use case where
 * inconsistent model arithmetic would be most costly. An alternative
 * design has the Service layer compute `overallScore` deterministically
 * from `categoryBreakdown`'s `score` and `weight` fields instead of
 * trusting the model's own aggregate. Each breakdown entry's `weight`
 * field is included specifically so this alternative remains possible
 * later without a schema change. Not silently decided either way —
 * confirm before File 137 (the Service layer) locks in the write path.
 *
 * KEY DECISION — `contributingEvidence` is an array of human-readable
 * strings, not IDs, per category. Same workaround as File 125's
 * `sourceSummary`, for the identical reason: none of the upstream
 * schemas carry a stable per-flag `id`, so there is nothing structural
 * to reference. Plural (vs. `sourceSummary`'s singular string) because a
 * single category score is expected to synthesize across many upstream
 * flags at once (e.g. "completeness" alone may draw from every missing-
 * clause flag), not typically one.
 *
 * KEY DECISION — `categoryBreakdown` must contain EXACTLY one entry per
 * `LegalHealthCategory` value, enforced via `superRefine`, not just
 * `.length(4)` (which would still allow a duplicate category alongside
 * a missing one). This is new: no prior module's array output needed
 * exhaustive-coverage validation, because none had a fixed, closed
 * category set the model must cover completely on every run.
 *
 * KEY DECISION — no `id` field, per-recommendation confidence score, or
 * other per-module-instance metadata on this schema, unlike prior
 * modules' flag schemas. This is intentional: this module's output is
 * a single composite assessment for the whole analysis, not a list of
 * independently identifiable records — there is nothing to key by.
 */

export const LegalHealthCategory = z.enum([
  'risk',
  'compliance',
  'completeness',
  'negotiation_leverage',
]);
export type LegalHealthCategory = z.infer<typeof LegalHealthCategory>;

const categoryScoreDetailSchema = z.object({
  category: LegalHealthCategory.describe(
    'Which of the four fixed health categories this entry scores. Every run must include exactly one entry for each of the four categories — never fewer, never a duplicate.',
  ),
  score: z
    .number()
    .min(0)
    .max(100)
    .describe(
      'This category\'s score from 0 (severe issues, no mitigating factors) to 100 (no material issues found for this category across the relevant upstream module(s)). Scores are meant to be comparable across documents of the same type — do not curve relative to "how bad documents of this kind usually are."',
    ),
  weight: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'This category\'s proportional contribution toward overallScore, from 0 to 1. The four weights across a single run\'s categoryBreakdown should sum to 1. Weight may vary by document type (e.g. a compliance-heavy regulatory filing may weight "compliance" more heavily than "negotiation_leverage") — state the weighting rationale in this category\'s rationale field when weights deviate from an even 0.25 split.',
    ),
  rationale: z
    .string()
    .describe(
      'Why this category received this score — which upstream findings drove it up or down, and what synthesizing across those findings revealed that no single upstream flag showed on its own (e.g. "three separate risk flags all concern the same uncapped indemnity clause, so the underlying exposure is singular even though it was reported three times").',
    ),
  contributingEvidence: z
    .array(z.string())
    .min(1)
    .describe(
      'Brief, human-readable references to the specific upstream flag(s) or recommendation(s) this category score draws from (e.g. "Risk Detection\'s hidden_liability flag on the indemnity clause", "AI Recommendation Engine\'s critical-priority recommendation to cap liability"). Not a structured reference — the upstream schemas have no stable ID to reference directly, so this is a descriptive trace only, plural because a single category typically synthesizes across several upstream findings at once.',
    ),
});
export type CategoryScoreDetail = z.infer<typeof categoryScoreDetailSchema>;

/**
 * The complete structured result of one Legal Health Score run. Top-level
 * schema passed to the AI Provider Layer's generateStructured() call, and
 * what gets stored, once validated, in legal_health_scores.result (see
 * the File 132 migration). The promoted legal_health_scores.overall_score
 * and legal_health_scores.category_scores columns are both derived from
 * this schema's output by the Service layer, not requested from the
 * model as separate shapes — see the KEY DECISIONs above.
 */
export const legalHealthScoreResultSchema = z
  .object({
    overallScore: z
      .number()
      .min(0)
      .max(100)
      .describe(
        'The single composite legal health score for this document, from 0 (severe, unaddressed legal exposure) to 100 (no material issues found across any category). Should be consistent with a weighted synthesis of the four categoryBreakdown entries using their respective weight values — do not state a number disconnected from the category-level detail.',
      ),
    categoryBreakdown: z
      .array(categoryScoreDetailSchema)
      .length(4)
      .describe(
        'Exactly one detailed score entry for each of the four fixed categories: risk, compliance, completeness, and negotiation_leverage. Every run must cover all four, even when a category has no material findings (in which case score that category near 100 and say so plainly in its rationale, rather than omitting it).',
      ),
  })
  .superRefine((data, ctx) => {
    const seen = new Set(data.categoryBreakdown.map((entry) => entry.category));
    for (const category of LegalHealthCategory.options) {
      if (!seen.has(category)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `categoryBreakdown is missing a required entry for category "${category}"`,
          path: ['categoryBreakdown'],
        });
      }
    }
    if (seen.size !== data.categoryBreakdown.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'categoryBreakdown must not contain duplicate category entries',
        path: ['categoryBreakdown'],
      });
    }
  });

export type LegalHealthScoreResult = z.infer<typeof legalHealthScoreResultSchema>;

/**
 * The flat shape stored in the promoted legal_health_scores.category_scores
 * column (see File 132's KEY DECISION on why this column exists
 * separately from `result`). Not requested from the AI model directly —
 * the not-yet-built Service layer derives this object by mapping over a
 * validated `LegalHealthScoreResult.categoryBreakdown`, so there is
 * exactly one source of truth (the model's categoryBreakdown output) and
 * one deterministic derivation, rather than two independent model
 * outputs that could disagree. Exported here so the Repository/Service
 * layers share one canonical shape and validator for this column instead
 * of each re-deriving their own.
 */
export const categoryScoresSchema = z.object({
  risk: z.number().min(0).max(100),
  compliance: z.number().min(0).max(100),
  completeness: z.number().min(0).max(100),
  negotiationLeverage: z.number().min(0).max(100),
});
export type CategoryScores = z.infer<typeof categoryScoresSchema>;