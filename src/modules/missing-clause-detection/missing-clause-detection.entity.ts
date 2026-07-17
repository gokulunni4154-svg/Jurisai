import type { MissingClauseDetectionResult } from '@/modules/missing-clause-detection/missing-clause-detection.schemas';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';

export type MissingClauseDetectionStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Mirrors the `missing_clause_detections` table (see migration
 * 20260717000000_missing_clause_detections.sql, File 108). This is the
 * shape returned by BaseRepository<'missing_clause_detections'> —
 * snake_case, matching Postgrest's default column naming, consistent
 * with risk-detection.entity.ts's (File 102) and
 * clause-classification.entity.ts's (File 94) convention (no camelCase
 * mapping layer anywhere in this project).
 *
 * `status` is typed here as a plain string union rather than re-derived
 * from the database's missing_clause_detection_status enum — same
 * choice risk-detection.entity.ts, clause-classification.entity.ts, and
 * document-analysis.entity.ts already made for their own status columns,
 * kept consistent here rather than introducing a new pattern for one
 * table.
 */
export interface MissingClauseDetection {
  id: string;
  document_analysis_id: string;
  status: MissingClauseDetectionStatus;
  result: MissingClauseDetectionResult | null;
  provider_used: AIProviderName | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Fields required to create a new missing clause detection run.
 * Everything else (status, result, provider_used, error_message,
 * timestamps) is either defaulted by the database or populated later as
 * the run progresses from pending -> processing -> completed/failed —
 * identical lifecycle shape to CreateRiskDetectionInput and
 * CreateClauseClassificationInput.
 */
export interface CreateMissingClauseDetectionInput {
  document_analysis_id: string;
}