import type { ClauseClassificationResult } from '@/modules/clause-classification/clause-classification.schemas';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';

export type ClauseClassificationStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Mirrors the `clause_classifications` table (see migration
 * 20260715053335_clause_classifications.sql, File 92). This is the shape
 * returned by BaseRepository<'clause_classifications'> — snake_case,
 * matching Postgrest's default column naming, consistent with
 * document-analysis.entity.ts's convention (no camelCase mapping layer
 * anywhere in this project).
 *
 * `status` is typed here as a plain string union rather than re-derived
 * from the database's clause_classification_status enum — same choice
 * document-analysis.entity.ts already made for its own status column, kept
 * consistent here rather than introducing a new pattern for one table.
 */
export interface ClauseClassification {
  id: string;
  document_analysis_id: string;
  status: ClauseClassificationStatus;
  result: ClauseClassificationResult | null;
  provider_used: AIProviderName | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Fields required to create a new classification run. Everything else
 * (status, result, provider_used, error_message, timestamps) is either
 * defaulted by the database or populated later as the run progresses from
 * pending -> processing -> completed/failed — identical lifecycle shape to
 * CreateDocumentAnalysisInput.
 */
export interface CreateClauseClassificationInput {
  document_analysis_id: string;
}