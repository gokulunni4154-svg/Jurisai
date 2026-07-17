import { z } from 'zod';

import { ClauseCategory } from '@/modules/document-analysis/analysis.schemas';

/**
 * Zod schema describing the structured output of the Clause Classification
 * Engine. Passed as `AIGenerationRequest.schema` (ai-provider.interface.ts,
 * File 58) — the model is constrained to return exactly this shape.
 *
 * Deliberately reuses `ClauseCategory` from analysis.schemas.ts (File 62)
 * rather than defining a parallel enum. Document Analysis's `keyClauses`
 * is a curated "clauses worth highlighting" summary; this module's job is
 * different and complementary — classify EVERY clause found in the
 * document, exhaustively, so later Phase 2 stages (Risk Detection, Missing
 * Clause Detection, Compliance Detection) have a complete, first-class
 * dataset to depend on directly, per the module-boundary reasoning already
 * recorded in the constitution doc. Both modules describing clauses with
 * the same category vocabulary is what makes that dependency safe — two
 * separately-evolving category enums for the same concept would let
 * Risk Detection silently query against categories Classification never
 * actually produces.
 *
 * `.describe()` calls follow the same convention as analysis.schemas.ts:
 * they become part of the JSON Schema sent to both providers and
 * materially affect output quality, so they're kept concrete and
 * instructive rather than restating the field name.
 */

const classifiedClauseSchema = z.object({
  category: ClauseCategory,
  excerpt: z
    .string()
    .describe(
      'The clause text, verbatim from the original document, that this classification applies to. Should be long enough to stand alone as evidence for the category assigned, not a fragment.',
    ),
  order: z
    .number()
    .int()
    .min(0)
    .describe(
      'This clause\'s position among all classified clauses in the document, in reading order, starting at 0. Used by downstream consumers (e.g. a document timeline view) to reconstruct clause order without re-parsing the source document.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'The model\'s confidence that this excerpt was correctly assigned to `category`, from 0 (uncertain) to 1 (certain). Low-confidence classifications are expected to be surfaced distinctly in the UI (e.g. flagged for review) rather than presented with the same authority as high-confidence ones — the field exists to make that distinction possible downstream, not as an internal-only diagnostic.',
    ),
});
export type ClassifiedClause = z.infer<typeof classifiedClauseSchema>;

/**
 * The complete structured result of one clause classification run. This
 * is the top-level schema passed to the AI Provider Layer's
 * generateStructured() call, and is what gets stored, once validated, in
 * clause_classifications.result (see the File 92 migration).
 */
export const clauseClassificationResultSchema = z.object({
  clauses: z
    .array(classifiedClauseSchema)
    .describe(
      'Every distinct clause identified in the document, in document reading order. This should be exhaustive, not a curated highlight list — later pipeline stages (Risk Detection, Missing Clause Detection) depend on this being a complete breakdown of the document\'s clauses, not a summary of the most important ones.',
    ),
});

export type ClauseClassificationResult = z.infer<typeof clauseClassificationResultSchema>;