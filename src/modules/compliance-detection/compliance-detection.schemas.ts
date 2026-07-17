import { z } from 'zod';

import { ClauseCategory } from '@/modules/document-analysis/analysis.schemas';

/**
 * Zod schema describing the structured output of the Compliance
 * Detection module. Passed as `AIGenerationRequest.schema`
 * (ai-provider.interface.ts, File 58) — the model is constrained to
 * return exactly this shape. Follows risk-detection.schemas.ts (File
 * 101) and missing-clause-detection.schemas.ts (File 109) directly:
 * `.describe()` calls are kept concrete and instructive (they become
 * part of the JSON Schema sent to both providers and materially affect
 * output quality), and shared vocabulary is reused rather than
 * redefined in parallel wherever the same concept genuinely applies.
 *
 * KEY DECISION — `ComplianceFramework` is scoped exactly to what was
 * confirmed for this module's first pass: Indian Contract Act core
 * requirements, stamp duty/registration, and sector-specific frameworks
 * selected by document type (Consumer Protection Act, DPDP Act, labour
 * law named as examples). Shipped as a fixed enum now, with an
 * explicitly expected extending amendment later, per that same
 * confirmation — not silently expanded beyond the named frameworks.
 *
 * KEY DECISION — a `type` discriminator IS required here, unlike File
 * 109's deliberate omission. File 109 could omit `type` because Missing
 * Clause Detection has exactly one flag shape. Compliance Detection
 * cannot collapse to one shape: a compliance problem is either a
 * required element entirely absent from the document
 * (`missing_requirement` — e.g. no stamp duty clause at all) or an
 * existing clause that actively conflicts with a framework's
 * requirement (`non_compliant_clause` — e.g. a clause violating a DPDP
 * Act consent requirement). These two cases have different excerpt
 * semantics, the same underlying reason File 101 needed `type` across
 * its nine risk kinds.
 *
 * KEY DECISION — `category: ClauseCategory` stays OPTIONAL, mirroring
 * File 101 rather than File 109's required treatment. Not every
 * compliance issue is clause-shaped: stamp duty/registration
 * requirements are frequently document-level, not tied to any single
 * `ClauseCategory`, so optionality is correct here the same way it was
 * for File 101's `missing_clause` risk type.
 *
 * KEY DECISION — `excerpt` is optional, same root cause as File 101's
 * identical decision: `missing_requirement` flags describe something
 * NOT present in the document, so no verbatim excerpt can exist for
 * them. Never fabricate placeholder text for this field when the issue
 * is an absence — leave it unset instead, per the same system-prompt
 * convention established for Risk Detection and Missing Clause
 * Detection.
 *
 * KEY DECISION — a fresh `ComplianceSeverity` enum, not a reuse of
 * File 101's `RiskSeverity` or File 109's `MissingClauseImportance`.
 * Severity/importance-shaped vocabulary was never established as
 * cross-module shared vocabulary the way `ClauseCategory` was — both
 * prior modules defined their own rather than reusing one merely
 * because the shape looked similar. Continuing that same discipline
 * here rather than breaking it on the third module to use it.
 *
 * KEY DECISION — `framework` is required (not optional) on every flag.
 * Unlike `category`, every compliance flag by definition belongs to
 * exactly one named framework — there is no "genuinely no framework
 * applies" case analogous to `category`'s optionality.
 *
 * KEY DECISION — no top-level summary/count field (e.g.
 * `complianceScore`) on `complianceDetectionResultSchema`. Same
 * module-boundary discipline as File 101's and File 109's identical
 * omission — aggregate scoring is the Legal Health Score Engine's
 * future responsibility, not this module's.
 *
 * NOT YET INCLUDED, flagged rather than silently assumed: a statutory
 * citation field (e.g. exact section/act reference) was considered but
 * left out of this first pass — it's new domain-modeling scope beyond
 * what was confirmed (framework taxonomy, not citation granularity).
 * Worth raising before the Service layer (File 121) if citation-level
 * precision is wanted in the AI's output shape.
 */

export const ComplianceFramework = z.enum([
  'indian_contract_act',
  'stamp_duty_registration',
  'consumer_protection_act',
  'dpdp_act',
  'labour_law',
]);
export type ComplianceFramework = z.infer<typeof ComplianceFramework>;

export const ComplianceIssueType = z.enum(['missing_requirement', 'non_compliant_clause']);
export type ComplianceIssueType = z.infer<typeof ComplianceIssueType>;

export const ComplianceSeverity = z.enum(['low', 'medium', 'high', 'critical']);
export type ComplianceSeverity = z.infer<typeof ComplianceSeverity>;

const complianceFlagSchema = z.object({
  type: ComplianceIssueType.describe(
    'Whether this issue is a required element that is entirely absent from the document ("missing_requirement") or an existing clause that actively conflicts with a framework\'s requirement ("non_compliant_clause"). Use "missing_requirement" only when nothing in the document attempts to address the requirement at all — if a clause exists but fails to meet the standard, use "non_compliant_clause" instead.',
  ),
  framework: ComplianceFramework.describe(
    'The specific compliance framework this issue falls under (e.g. Indian Contract Act, stamp duty/registration requirements, Consumer Protection Act, DPDP Act, labour law). Every flag must map to exactly one framework.',
  ),
  severity: ComplianceSeverity.describe(
    'How serious this compliance issue is if left unaddressed. "critical" should be reserved for issues creating real legal exposure (e.g. an unstamped document that would be inadmissible as evidence, a clause voiding statutory consumer protections), not simply "the most notable issue in an otherwise-compliant document" — severity is meant to be comparable across documents, not curved per document.',
  ),
  category: ClauseCategory.optional().describe(
    'For issues tied to an existing clause, the category that clause belongs to. For "missing_requirement" issues that are document-level rather than clause-level (e.g. stamp duty/registration), omit this field rather than forcing an inexact category.',
  ),
  excerpt: z
    .string()
    .optional()
    .describe(
      'The clause text, verbatim from the original document, that this compliance issue applies to. Only applicable for "non_compliant_clause" issues — never fabricate placeholder text for "missing_requirement" issues, where by definition no such text exists in the document; leave unset instead.',
    ),
  explanation: z
    .string()
    .describe(
      'A plain-language explanation of why this is a compliance issue under the stated framework and what legal exposure it creates for the document owner — written for someone without a legal background.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'The model\'s confidence that this flag is a genuine compliance issue, from 0 (uncertain) to 1 (certain). Same downstream purpose as risk-detection.schemas.ts\'s identical field: low-confidence flags are expected to be surfaced distinctly (e.g. for human review) rather than presented with the same authority as high-confidence ones.',
    ),
});
export type ComplianceFlag = z.infer<typeof complianceFlagSchema>;

/**
 * The complete structured result of one compliance detection run.
 * Top-level schema passed to the AI Provider Layer's generateStructured()
 * call, and what gets stored, once validated, in
 * compliance_detections.result (see the File 116 migration).
 */
export const complianceDetectionResultSchema = z.object({
  flags: z
    .array(complianceFlagSchema)
    .describe(
      'Every distinct compliance issue identified in the document across all applicable frameworks, covering both missing required elements and existing clauses that conflict with a framework\'s requirements. This should be exhaustive for genuine issues, not limited to the single most severe one — a document owner needs the full compliance picture, not just the worst line item.',
    ),
});

export type ComplianceDetectionResult = z.infer<typeof complianceDetectionResultSchema>;