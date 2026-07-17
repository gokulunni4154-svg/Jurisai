import { z } from 'zod';

import { ClauseCategory } from '@/modules/document-analysis/analysis.schemas';

/**
 * Zod schema describing the structured output of the Risk Detection
 * Engine. Passed as `AIGenerationRequest.schema` (ai-provider.interface.ts,
 * File 58) — the model is constrained to return exactly this shape.
 * Follows clause-classification.schemas.ts's (File 93) conventions
 * directly: `.describe()` calls are kept concrete and instructive (they
 * become part of the JSON Schema sent to both providers and materially
 * affect output quality), and shared vocabulary is reused rather than
 * redefined in parallel wherever the same concept genuinely applies.
 *
 * KEY DECISION — reuses `ClauseCategory` (analysis.schemas.ts, same
 * import File 93 uses) as an OPTIONAL field on each risk flag, not a
 * required one. File 93's own reasoning for reuse — a shared category
 * vocabulary is what makes Risk Detection safely queryable against
 * Clause Classification's output without two independently-evolving
 * enums for the same concept — still applies here. It's optional,
 * unlike File 93's required `category`, because not every risk type this
 * module detects has a clause to categorize: a `missing_clause` flag
 * describes an absence in the document, so there is no clause instance
 * to assign a category to in the usual sense — instead `category`
 * identifies WHICH category of clause is missing. Every other risk type
 * (high_risk_clause, illegal_clause, one_sided_clause, etc.) applies to
 * a clause that does exist, so `category` is expected to be populated
 * for those in practice, just not enforced at the schema level.
 *
 * KEY DECISION — `excerpt` is optional, unlike File 93's required
 * `excerpt`. Same root cause as above: `missing_clause` flags describe
 * text that is NOT present in the document, so there is no verbatim
 * excerpt to return — forcing the model to fabricate one would violate
 * the "never paraphrase, summarize, or reconstruct clause text" rule
 * File 93's own system prompt establishes for real excerpts, applied
 * here to its logical conclusion: for a flag type where no real excerpt
 * can exist, the field must allow absence rather than pressure the model
 * into inventing placeholder text that reads as if it were real.
 *
 * KEY DECISION — no `order` field, unlike File 93's `order`. File 93's
 * `order` exists so downstream consumers can reconstruct document
 * reading order without re-parsing the source. That only makes sense
 * for content that has a position IN the document — true for most risk
 * flags but, again, not for `missing_clause` flags, which have no
 * document position by definition. Rather than make `order` optional
 * and have downstream UI code special-case a sometimes-absent ordering
 * field, it's omitted entirely for this module; a risk-detection UI is
 * expected to group/sort by `severity` and `type` instead, not
 * document position.
 *
 * KEY DECISION — no top-level severity/score summary field (e.g.
 * `overallRiskLevel`) on `riskDetectionResultSchema`. The constitution's
 * roadmap lists "Legal Health Score Engine" as its own later, independent
 * module. Adding a summary/scoring field here would duplicate that
 * module's future responsibility and create the same two-sources-of-
 * truth risk File 93's docstring warns against for category vocabularies
 * — kept out deliberately, matching the project's stated module-boundary
 * discipline rather than a smaller-scope oversight.
 */

export const RiskType = z.enum([
  'high_risk_clause',
  'missing_clause',
  'illegal_clause',
  'one_sided_clause',
  'compliance_risk',
  'hidden_liability',
  'financial_risk',
  'negotiation_risk',
  'dangerous_obligation',
]);
export type RiskType = z.infer<typeof RiskType>;

export const RiskSeverity = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

const riskFlagSchema = z.object({
  type: RiskType.describe(
    'The category of risk this flag represents. Use "missing_clause" only when the document lacks a clause that should reasonably be present, not when a present clause is merely weak or one-sided — those cases belong under "one_sided_clause" or "high_risk_clause" instead.',
  ),
  severity: RiskSeverity.describe(
    'How serious this risk is if left unaddressed. "critical" should be reserved for risks with real legal or financial exposure (e.g. an illegal clause, an uncapped liability), not simply "the biggest issue in a low-risk document" — severity is meant to be comparable across documents, not curved per document.',
  ),
  category: ClauseCategory.optional().describe(
    'For risks tied to an existing clause, the category that clause belongs to. For "missing_clause" flags, the category of clause that is absent from the document. Omit only if genuinely no single category applies.',
  ),
  excerpt: z
    .string()
    .optional()
    .describe(
      'The clause text, verbatim from the original document, that this risk applies to. Required in practice for every risk type except "missing_clause", where by definition no such text exists in the document — never fabricate placeholder text for this field when the risk is an absence, leave it unset instead.',
    ),
  explanation: z
    .string()
    .describe(
      'A plain-language explanation of why this is a risk and what exposure it creates for the document owner — written for someone without a legal background, not restating the clause text or the risk type name.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'The model\'s confidence that this flag is a genuine, material risk, from 0 (uncertain) to 1 (certain). Same downstream purpose as clause-classification.schemas.ts\'s identical field: low-confidence flags are expected to be surfaced distinctly (e.g. for human review) rather than presented with the same authority as high-confidence ones.',
    ),
});
export type RiskFlag = z.infer<typeof riskFlagSchema>;

/**
 * The complete structured result of one risk detection run. Top-level
 * schema passed to the AI Provider Layer's generateStructured() call,
 * and what gets stored, once validated, in risk_detections.result (see
 * the File 100 migration).
 */
export const riskDetectionResultSchema = z.object({
  flags: z
    .array(riskFlagSchema)
    .describe(
      'Every distinct risk identified in the document, covering high-risk clauses, missing clauses, illegal clauses, one-sided clauses, compliance risks, hidden liabilities, financial risks, negotiation risks, and dangerous obligations. This should be exhaustive for genuine risks, not limited to the single most severe issue — a document owner needs the full picture, not just the worst line item.',
    ),
});

export type RiskDetectionResult = z.infer<typeof riskDetectionResultSchema>;