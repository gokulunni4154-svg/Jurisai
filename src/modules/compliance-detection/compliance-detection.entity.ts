import type { ComplianceDetectionResult } from '@/modules/compliance-detection/compliance-detection.schemas';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';

export type ComplianceDetectionStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Mirrors the `compliance_detections` table (see migration
 * 20260718000000_compliance_detections.sql, File 116). This is the
 * shape returned by BaseRepository<'compliance_detections'> —
 * snake_case, matching Postgrest's default column naming, consistent
 * with missing-clause-detection.entity.ts's (File 110),
 * risk-detection.entity.ts's (File 102), and
 * clause-classification.entity.ts's (File 94) convention (no camelCase
 * mapping layer anywhere in this project).
 *
 * `status` is typed here as a plain string union rather than re-derived
 * from the database's compliance_detection_status enum — same choice
 * missing-clause-detection.entity.ts, risk-detection.entity.ts, and
 * clause-classification.entity.ts already made for their own status
 * columns, kept consistent here rather than introducing a new pattern
 * for one table.
 */
export interface ComplianceDetection {
  id: string;
  document_analysis_id: string;
  status: ComplianceDetectionStatus;
  result: ComplianceDetectionResult | null;
  provider_used: AIProviderName | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Fields required to create a new compliance detection run. Everything
 * else (status, result, provider_used, error_message, timestamps) is
 * either defaulted by the database or populated later as the run
 * progresses from pending -> processing -> completed/failed — identical
 * lifecycle shape to CreateMissingClauseDetectionInput and
 * CreateRiskDetectionInput.
 */
export interface CreateComplianceDetectionInput {
  document_analysis_id: string;
}