import type { DocumentAnalysisResult } from '@/modules/document-analysis/analysis.schemas';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';

export type DocumentAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Mirrors the `document_analyses` table (see migration
 * 002_document_analyses.sql, File 63). This is the shape returned by
 * BaseRepository<DocumentAnalysis> — snake_case, matching Postgrest's
 * default column naming, consistent with how other entities in this
 * project are typed (no camelCase mapping layer).
 */
export interface DocumentAnalysis {
  id: string;
  document_id: string;
  status: DocumentAnalysisStatus;
  result: DocumentAnalysisResult | null;
  provider_used: AIProviderName | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Fields required to create a new analysis run. Everything else
 * (status, result, provider_used, error_message, timestamps) is either
 * defaulted by the database or populated later as the analysis
 * progresses from pending -> processing -> completed/failed.
 */
export interface CreateDocumentAnalysisInput {
  document_id: string;
}