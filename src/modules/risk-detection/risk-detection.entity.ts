import type { RiskDetectionResult } from '@/modules/risk-detection/risk-detection.schemas';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';

export type RiskDetectionStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Mirrors the `risk_detections` table (see migration
 * 20260716000000_risk_detections.sql, File 100). This is the shape
 * returned by BaseRepository<'risk_detections'> — snake_case, matching
 * Postgrest's default column naming, consistent with
 * clause-classification.entity.ts's (File 94) and
 * document-analysis.entity.ts's convention (no camelCase mapping layer
 * anywhere in this project).
 *
 * `status` is typed here as a plain string union rather than re-derived
 * from the database's risk_detection_status enum — same choice
 * clause-classification.entity.ts and document-analysis.entity.ts already
 * made for their own status columns, kept consistent here rather than
 * introducing a new pattern for one table.
 */
export interface RiskDetection {
  id: string;
  document_analysis_id: string;
  status: RiskDetectionStatus;
  result: RiskDetectionResult | null;
  provider_used: AIProviderName | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Fields required to create a new risk detection run. Everything else
 * (status, result, provider_used, error_message, timestamps) is either
 * defaulted by the database or populated later as the run progresses from
 * pending -> processing -> completed/failed — identical lifecycle shape to
 * CreateClauseClassificationInput and CreateDocumentAnalysisInput.
 */
export interface CreateRiskDetectionInput {
  document_analysis_id: string;
}