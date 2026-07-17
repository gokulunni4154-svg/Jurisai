import { z } from 'zod';

import { ClauseCategory } from '@/modules/document-analysis/analysis.schemas';

/**
 * Zod schema describing the structured output of the Missing Clause
 * Detection module. Passed as `AIGenerationRequest.schema`
 * (ai-provider.interface.ts, File 58) — the model is constrained to
 * return exactly this shape. Follows risk-detection.schemas.ts's (File
 * 101) conventions directly: `.describe()` calls are kept concrete and
 * instructive (they become part of the JSON Schema sent to both
 * providers and materially affect output quality), and shared
 * vocabulary is reused rather than redefined in parallel wherever the
 * same concept genuinely applies.
 *
 * KEY DECISION — `category: ClauseCategory` is REQUIRED here, unlike
 * File 101's optional `category`. File 101 needs optionality because
 * its schema covers nine different risk types, most of which apply to
 * an existing clause and only one of which (`missing_clause`) concerns
 * an absence. This module has no other flag type to accommodate — every
 * flag it produces IS a missing-clause report by definition, so the
 * category of the absent clause is the entire content of the flag, not
 * an optional annotation on it. Reuses `ClauseCategory` itself (same
 * import File 93 and File 101 both use) for the same reason File 101
 * reused it: a shared category vocabulary is what makes this module's
 * output safely cross-referenceable against Clause Classification's own
 * output, without two independently-evolving enums for the same concept.
 *
 * KEY DECISION — no `type` discriminator field. File 101 needs `type`
 * because one schema spans nine distinct risk kinds. This schema only
 * ever describes one kind of thing — an expected clause category that is
 * absent from the document — so there is nothing to discriminate between.
 *
 * KEY DECISION — no `excerpt` field, not even optional. File 101 keeps
 * `excerpt` optional specifically so its `missing_clause` flags (one of
 * nine types) can coexist with eight other types that do have real
 * clause text. Every flag in THIS module is the missing-clause case, so
 * there is never a scenario where a verbatim excerpt applies. Omitting
 * the field entirely, rather than carrying it as an always-empty
 * optional, removes any surface for the model to fabricate placeholder
 * text — the exact failure mode File 101's own system-prompt convention
 * (never paraphrase, summarize, or reconstruct clause text) guards
 * against for real excerpts, applied here to its logical conclusion.
 *
 * KEY DECISION — no `order` field, same reasoning as File 101's
 * identical omission for its own `missing_clause` flags: an absent
 * clause has no position in the document to reconstruct. A downstream UI
 * is expected to group/sort by `importance`, not document position.
 *
 * KEY DECISION — a fresh `MissingClauseImportance` enum, not a reuse of
 * File 101's `RiskSeverity`. `ClauseCategory` reuse is justified because
 * category is genuinely shared vocabulary between Clause Classification
 * and Risk Detection (File 93's own stated reasoning, extended above).
 * Severity/importance was never established as shared vocabulary
 * anywhere in this project — File 101 itself defined `RiskSeverity`
 * fresh for its own module rather than reusing something from Document
 * Analysis or Clause Classification. Following that same precedent means
 * defining this module's own enum too, not reusing `RiskSeverity` merely
 * because the shape looks similar. Named `importance` rather than
 * `severity` deliberately: this module reports an absence, not an active
 * risk in the document, and "importance of this clause being present"
 * is a more accurate description than "severity," which implies harm
 * already embedded in existing text.
 *
 * KEY DECISION — no top-level summary/count field (e.g.
 * `missingClauseCount`) on `missingClauseDetectionResultSchema`. Same
 * module-boundary discipline as File 101's identical omission —
 * aggregate scoring is the Legal Health Score Engine's future
 * responsibility, not this module's.
 */

export const MissingClauseImportance = z.enum(['low', 'medium', 'high', 'critical']);
export type MissingClauseImportance = z.infer<typeof MissingClauseImportance>;

const missingClauseFlagSchema = z.object({
  category: ClauseCategory.describe(
    'The category of clause that should reasonably be present for this type of document but is absent from the clause breakdown. Only flag a category here if its absence is genuinely notable for this document type — not for stylistic or optional clauses that many valid documents simply omit.',
  ),
  importance: MissingClauseImportance.describe(
    'How significant it is that this clause category is missing. "critical" should be reserved for absences that create real legal or financial exposure (e.g. no termination clause, no liability cap, no dispute resolution mechanism), not simply "the most notable gap in a document with few gaps" — importance is meant to be comparable across documents, not curved per document.',
  ),
  explanation: z
    .string()
    .describe(
      'A plain-language explanation of why a clause in this category is normally expected for this type of document, and what risk or exposure its absence creates for the document owner — written for someone without a legal background.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'The model\'s confidence that this category is genuinely expected and genuinely absent, from 0 (uncertain) to 1 (certain). Same downstream purpose as risk-detection.schemas.ts\'s identical field: low-confidence flags are expected to be surfaced distinctly (e.g. for human review) rather than presented with the same authority as high-confidence ones.',
    ),
});
export type MissingClauseFlag = z.infer<typeof missingClauseFlagSchema>;

/**
 * The complete structured result of one missing clause detection run.
 * Top-level schema passed to the AI Provider Layer's generateStructured()
 * call, and what gets stored, once validated, in
 * missing_clause_detections.result (see the File 108 migration).
 */
export const missingClauseDetectionResultSchema = z.object({
  flags: z
    .array(missingClauseFlagSchema)
    .describe(
      'Every clause category genuinely expected for this type of document but absent from the prior clause classification breakdown. This should be exhaustive for genuine gaps, not limited to the single most important omission — a document owner needs the full picture of what is missing, not just the worst gap.',
    ),
});

export type MissingClauseDetectionResult = z.infer<typeof missingClauseDetectionResultSchema>;