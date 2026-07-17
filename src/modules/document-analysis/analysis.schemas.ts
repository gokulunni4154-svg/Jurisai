import { z } from 'zod';

/**
 * Zod schemas describing the structured output of an AI document
 * analysis. This is the schema passed as `AIGenerationRequest.schema`
 * (see ai-provider.interface.ts, File 58) — the model is constrained to
 * return exactly this shape, so every field defined here is a field the
 * customer will actually see rendered in the UI. Nothing here is
 * decorative: if a field isn't worth showing to a customer, it doesn't
 * belong in this schema.
 *
 * `.describe()` calls are not just documentation — they become part of
 * the JSON Schema sent to both providers and materially affect output
 * quality (Gemini's and OpenAI's docs both note this). Keep them
 * concrete and instructive, not just a restatement of the field name.
 */

export const RiskSeverity = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const ClauseCategory = z.enum([
  'termination',
  'liability',
  'payment',
  'confidentiality',
  'indemnification',
  'dispute_resolution',
  'intellectual_property',
  'force_majeure',
  'renewal',
  'other',
]);
export type ClauseCategory = z.infer<typeof ClauseCategory>;

const riskFlagSchema = z.object({
  severity: RiskSeverity.describe(
    'How serious this issue is for the party relying on this analysis. "critical" means likely to cause significant financial or legal harm if unaddressed.',
  ),
  title: z.string().describe('A short (under 10 words) plain-language label for the risk, e.g. "Unlimited liability exposure".'),
  description: z
    .string()
    .describe('2-3 sentences in plain language explaining what the risk is and why it matters, written for a non-lawyer.'),
  clauseReference: z
    .string()
    .optional()
    .describe('The clause number or section heading this risk originates from, if the document has identifiable section markers.'),
  recommendation: z
    .string()
    .describe('A concrete, actionable next step the customer could take — e.g. "Request a liability cap of 12 months\' fees" — not generic advice like "consult a lawyer".'),
});
export type RiskFlag = z.infer<typeof riskFlagSchema>;

const extractedClauseSchema = z.object({
  title: z.string().describe('Short label for this clause, e.g. "Termination for Convenience".'),
  category: ClauseCategory,
  excerpt: z.string().describe('The relevant portion of the original document text, verbatim, supporting this clause entry.'),
  plainLanguageExplanation: z
    .string()
    .describe('1-3 sentences explaining what this clause means in practice, written for a non-lawyer.'),
});
export type ExtractedClause = z.infer<typeof extractedClauseSchema>;

const keyDateSchema = z.object({
  date: z.string().describe('ISO 8601 date (YYYY-MM-DD). If the document gives a relative date (e.g. "30 days after signing") without an absolute date, omit this entry rather than guessing a date.'),
  description: z.string().describe('What happens on or by this date, in plain language.'),
  dateType: z
    .enum(['deadline', 'renewal', 'expiry', 'effective_date', 'notice_period', 'other'])
    .describe('The category of this date, used for downstream timeline grouping.'),
});
export type KeyDate = z.infer<typeof keyDateSchema>;

const missingClauseSchema = z.object({
  clauseType: ClauseCategory,
  whyItMatters: z
    .string()
    .describe('1-2 sentences explaining, in plain language, why the absence of this clause is worth the customer\'s attention.'),
});
export type MissingClause = z.infer<typeof missingClauseSchema>;

/**
 * The complete structured result of analyzing one document. This is the
 * top-level schema passed to generateWithFallback().
 */
export const documentAnalysisResultSchema = z.object({
  documentType: z
    .string()
    .describe('The type of legal document this appears to be, e.g. "Employment Agreement", "Non-Disclosure Agreement", "Lease Agreement". Be specific, not just "Contract".'),
  summary: z
    .string()
    .describe('A 3-5 sentence plain-language summary of what this document is, who the parties are, and its core purpose. Written for someone with no legal background.'),
  overallRiskScore: z
    .number()
    .min(0)
    .max(100)
    .describe('0 = no identifiable risk, 100 = severe risk requiring immediate legal attention. Should be consistent with the severities of riskFlags.'),
  riskFlags: z.array(riskFlagSchema).describe('Every material risk identified in the document, ordered from most to least severe.'),
  keyClauses: z.array(extractedClauseSchema).describe('The clauses most relevant to understanding this document\'s obligations and protections.'),
  keyDates: z.array(keyDateSchema).describe('Every date-bound obligation or deadline found in the document. Empty array if none exist.'),
  missingClauses: z
    .array(missingClauseSchema)
    .describe('Standard protective clauses this type of document would typically include but does not. Empty array if the document is reasonably complete.'),
  recommendedActions: z
    .array(z.string())
    .describe('3-5 concrete next steps for the customer, ordered by priority. Specific and actionable, not generic legal disclaimers.'),
});

export type DocumentAnalysisResult = z.infer<typeof documentAnalysisResultSchema>;