// src/modules/document-sets/document-set-analysis.schemas.ts
// Multi-document module — File number not yet assigned.
//
// Built directly against the real, pasted analysis.schemas.ts for
// conventions: Zod schemas as the AIGenerationRequest.schema passed to
// generateWithFallback(), `.describe()` calls treated as functional (part
// of the JSON Schema sent to both providers, not just documentation),
// every field justified by "will a customer actually see this rendered."
//
// SCOPE, CONFIRMED: this schema produces ONE combined summary/insight
// synthesis across an entire document_set — explicitly NOT pairwise
// comparison (e.g. "contract A vs B") and explicitly NOT conflict/
// inconsistency detection between documents. Those were both considered
// and deliberately not chosen as the priority when this module's scope
// was confirmed. If either is wanted later, it's a new schema (or a new
// field here), not silently folded into setOverview/insights below.

import { z } from 'zod';

const crossDocumentInsightSchema = z.object({
  title: z
    .string()
    .describe('A short (under 10 words) plain-language label for this pattern, e.g. "Inconsistent notice periods across agreements".'),
  narrative: z
    .string()
    .describe('2-4 sentences in plain language explaining the pattern connecting two or more documents in this set, and why it matters practically. Written for someone without a legal background.'),
  sourceDocumentIds: z
    .array(z.string())
    .min(1)
    .describe('The document ids (from this set) that genuinely contributed to this insight. Do not include a document that did not meaningfully drive this specific pattern.'),
  sourceDocumentTitles: z
    .array(z.string())
    .min(1)
    .describe('The titles of the documents in sourceDocumentIds, in the same order — included alongside the ids so the narrative can reference documents by name without a separate lookup.'),
});
export type CrossDocumentInsight = z.infer<typeof crossDocumentInsightSchema>;

/**
 * The complete structured result of synthesizing across every document in
 * a document_set. This is the top-level schema passed to
 * generateWithFallback() by the future DocumentSetService's synthesis
 * method — same role documentAnalysisResultSchema plays for a single
 * document.
 */
export const documentSetAnalysisResultSchema = z.object({
  setOverview: z
    .string()
    .describe('A 3-5 sentence plain-language summary of what this document set collectively represents — who the parties are across the set, the common thread connecting the documents, and the set\'s overall purpose. Written for someone with no legal background.'),
  keyThemes: z
    .array(z.string())
    .describe('Short (under 8 words each) recurring themes or topics that appear across multiple documents in the set, e.g. "Data protection obligations", "Early termination rights". Empty array if the documents share no genuine common themes.'),
  crossDocumentInsights: z
    .array(crossDocumentInsightSchema)
    .describe('Every genuine cross-document pattern worth surfacing, each drawing on two or more documents in the set. Do not manufacture insights to hit a target count — a set with few genuine cross-document patterns should produce few insights.'),
  recommendedActions: z
    .array(z.string())
    .describe('3-5 concrete next steps for the customer that consider the document set as a whole, ordered by priority. Specific and actionable, not generic legal disclaimers.'),
});

export type DocumentSetAnalysisResult = z.infer<typeof documentSetAnalysisResultSchema>;