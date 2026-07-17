// src/modules/compliance-detection/compliance-detection.repository.ts
// File 119 — JurisAI Compliance Detection module

import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';
import {
  complianceDetectionResultSchema,
  type ComplianceDetectionResult,
} from '@/modules/compliance-detection/compliance-detection.schemas';
import type { ComplianceDetection } from '@/modules/compliance-detection/compliance-detection.entity';

type ComplianceDetectionRow = Database['public']['Tables']['compliance_detections']['Row'];

/**
 * Repository for the compliance_detections table (File 116 migration,
 * which — like risk_detections' File 100 and missing_clause_detections'
 * File 108, and unlike clause_classifications' original File 92 —
 * already shipped with its write policies included from the start; see
 * File 116's own KEY DECISION comment).
 *
 * findById/findByIdOrThrow are overridden — identical rationale to
 * MissingClauseDetectionRepository's (File 111) and
 * RiskDetectionRepository's (File 103): TypeScript resolves
 * `this.findById` polymorphically even inside the base class's own
 * findByIdOrThrow, so overriding only findById would let
 * findByIdOrThrow silently call the override at runtime while staying
 * *declared* as returning the base Row type. Both are fully
 * reimplemented here rather than calling super, closing that gap
 * directly rather than partially — same as File 111 and File 103, and
 * built in from the start here rather than needing a follow-up
 * amendment the way File 95 originally did.
 */
export class ComplianceDetectionRepository extends BaseRepository<'compliance_detections'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'compliance_detections');
  }

  /**
   * Overrides BaseRepository#findById. Routes the row through parseRow()
   * so `result` is validated against complianceDetectionResultSchema
   * instead of trusted as an opaque Json blob — same reasoning as
   * MissingClauseDetectionRepository#findById and
   * RiskDetectionRepository#findById.
   */
  override async findById(id: string): Promise<ComplianceDetection | null> {
    const { data, error } = await this.supabase
      .from('compliance_detections')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(`Failed to find ${String(this.tableName)} by id`, error, {
        table: this.tableName,
        id,
      });
    }

    return data ? this.parseRow(data) : null;
  }

  /**
   * Overrides BaseRepository#findByIdOrThrow. Calls this class's own
   * findById() override (not super's), so the validated
   * ComplianceDetection type flows through consistently.
   */
  override async findByIdOrThrow(id: string): Promise<ComplianceDetection> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return row;
  }

  /**
   * Returns every compliance detection run for a given analysis, most
   * recent first. Plural by design — document_analysis_id is
   * intentionally NOT unique on this table (File 116), same reasoning
   * as missing_clause_detections and risk_detections: independent
   * re-runs of compliance detection against the same analysis are a
   * first-class part of this module's lifecycle, not an anomaly.
   */
  async findByDocumentAnalysisId(documentAnalysisId: string): Promise<ComplianceDetection[]> {
    const { data, error } = await this.supabase
      .from('compliance_detections')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list compliance_detections by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * Returns the most recent compliance detection run for a given
   * analysis, or null if none exists yet. This is the method the
   * service layer is expected to use for "what's the current compliance
   * detection" reads — findByDocumentAnalysisId is for surfacing run
   * history, not the common-path read. Identical purpose to
   * MissingClauseDetectionRepository#findLatestByDocumentAnalysisId and
   * RiskDetectionRepository#findLatestByDocumentAnalysisId.
   */
  async findLatestByDocumentAnalysisId(
    documentAnalysisId: string,
  ): Promise<ComplianceDetection | null> {
    const { data, error } = await this.supabase
      .from('compliance_detections')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find latest compliance_detection by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return data ? this.parseRow(data) : null;
  }

  /**
   * Transitions a compliance detection run from 'pending' to
   * 'processing'. Same purpose as
   * MissingClauseDetectionRepository#markProcessing — lets a caller
   * polling the row distinguish "queued" from "actually running".
   */
  async markProcessing(id: string): Promise<ComplianceDetection> {
    return this.applyTransition(id, { status: 'processing' });
  }

  /**
   * Transitions to 'completed', recording the result, which provider
   * produced it, and completed_at — all three required together, same
   * reasoning as MissingClauseDetectionRepository#markCompleted: a
   * 'completed' row with a null result is a state downstream consumers
   * have no valid way to handle.
   */
  async markCompleted(
    id: string,
    result: ComplianceDetectionResult,
    providerUsed: AIProviderName,
  ): Promise<ComplianceDetection> {
    return this.applyTransition(id, {
      status: 'completed',
      result,
      provider_used: providerUsed,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Transitions to 'failed', recording a user-safe message (sanitization
   * is the Service layer's job, same division of responsibility as
   * MissingClauseDetectionRepository#markFailed).
   */
  async markFailed(id: string, errorMessage: string): Promise<ComplianceDetection> {
    return this.applyTransition(id, {
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Shared implementation for the three transition methods above.
   * Private — every status change goes through one of the three named
   * methods instead of an arbitrary partial patch, same discipline as
   * MissingClauseDetectionRepository#applyTransition.
   */
  private async applyTransition(
    id: string,
    patch: Partial<
      Omit<ComplianceDetection, 'id' | 'document_analysis_id' | 'created_at'>
    >,
  ): Promise<ComplianceDetection> {
    const { data, error } = await this.supabase
      .from('compliance_detections')
      .update(patch as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update compliance detection status', error, {
        table: this.tableName,
        id,
        patch,
      });
    }

    if (!data) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return this.parseRow(data);
  }

  /**
   * Single point of conversion from a raw compliance_detections row
   * (result: generic Postgrest Json) to the validated
   * ComplianceDetection domain type (result: ComplianceDetectionResult
   * | null). Throws DatabaseError, not a raw ZodError, on mismatch —
   * same classification as MissingClauseDetectionRepository#parseRow
   * and RiskDetectionRepository#parseRow: a persisted result failing
   * schema validation is a data-integrity problem, not a normal
   * not-found/bad-request case.
   */
  private parseRow(row: ComplianceDetectionRow): ComplianceDetection {
    if (row.result === null) {
      return { ...row, result: null };
    }

    const parsed = complianceDetectionResultSchema.safeParse(row.result);

    if (!parsed.success) {
      throw new DatabaseError(
        'compliance_detections row contains a result that does not match the expected schema',
        parsed.error,
        { table: this.tableName, id: row.id },
      );
    }

    return { ...row, result: parsed.data };
  }
}

export type { CreateComplianceDetectionInput } from '@/modules/compliance-detection/compliance-detection.entity';