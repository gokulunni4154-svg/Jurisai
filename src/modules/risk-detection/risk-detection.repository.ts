// src/modules/risk-detection/risk-detection.repository.ts
// File 103 — JurisAI Risk Detection module

import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';
import {
  riskDetectionResultSchema,
  type RiskDetectionResult,
} from '@/modules/risk-detection/risk-detection.schemas';
import type { RiskDetection } from '@/modules/risk-detection/risk-detection.entity';

type RiskDetectionRow = Database['public']['Tables']['risk_detections']['Row'];

/**
 * Repository for the risk_detections table (File 100 migration, which —
 * unlike clause_classifications' original File 92 — already shipped with
 * its write policies included; see File 100's own KEY DECISION comment).
 *
 * findById/findByIdOrThrow are overridden — identical rationale to
 * ClauseClassificationRepository's (File 95, Amendment #1) and
 * DocumentAnalysisRepository's: TypeScript resolves `this.findById`
 * polymorphically even inside the base class's own findByIdOrThrow, so
 * overriding only findById would let findByIdOrThrow silently call the
 * override at runtime while staying *declared* as returning the base Row
 * type. Both are fully reimplemented here rather than calling super,
 * closing that gap directly rather than partially — same as File 95, and
 * built in from the start here rather than needing a follow-up amendment
 * the way File 95 did.
 */
export class RiskDetectionRepository extends BaseRepository<'risk_detections'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'risk_detections');
  }

  /**
   * Overrides BaseRepository#findById. Routes the row through parseRow()
   * so `result` is validated against riskDetectionResultSchema instead
   * of trusted as an opaque Json blob — same reasoning as
   * ClauseClassificationRepository#findById.
   */
  override async findById(id: string): Promise<RiskDetection | null> {
    const { data, error } = await this.supabase
      .from('risk_detections')
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
   * findById() override (not super's), so the validated RiskDetection
   * type flows through consistently.
   */
  override async findByIdOrThrow(id: string): Promise<RiskDetection> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return row;
  }

  /**
   * Returns every risk detection run for a given analysis, most recent
   * first. Plural by design — document_analysis_id is intentionally NOT
   * unique on this table (File 100), same reasoning as
   * clause_classifications: independent re-runs of risk detection
   * against the same analysis are a first-class part of this module's
   * lifecycle, not an anomaly.
   */
  async findByDocumentAnalysisId(documentAnalysisId: string): Promise<RiskDetection[]> {
    const { data, error } = await this.supabase
      .from('risk_detections')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError('Failed to list risk_detections by document_analysis_id', error, {
        table: this.tableName,
        documentAnalysisId,
      });
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * Returns the most recent risk detection run for a given analysis, or
   * null if none exists yet. This is the method the service layer is
   * expected to use for "what's the current risk detection" reads —
   * findByDocumentAnalysisId is for surfacing run history, not the
   * common-path read. Identical purpose to
   * ClauseClassificationRepository#findLatestByDocumentAnalysisId.
   */
  async findLatestByDocumentAnalysisId(
    documentAnalysisId: string,
  ): Promise<RiskDetection | null> {
    const { data, error } = await this.supabase
      .from('risk_detections')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find latest risk_detection by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return data ? this.parseRow(data) : null;
  }

  /**
   * Transitions a risk detection run from 'pending' to 'processing'.
   * Same purpose as ClauseClassificationRepository#markProcessing — lets
   * a caller polling the row distinguish "queued" from "actually
   * running".
   */
  async markProcessing(id: string): Promise<RiskDetection> {
    return this.applyTransition(id, { status: 'processing' });
  }

  /**
   * Transitions to 'completed', recording the result, which provider
   * produced it, and completed_at — all three required together, same
   * reasoning as ClauseClassificationRepository#markCompleted: a
   * 'completed' row with a null result is a state downstream consumers
   * have no valid way to handle.
   */
  async markCompleted(
    id: string,
    result: RiskDetectionResult,
    providerUsed: AIProviderName,
  ): Promise<RiskDetection> {
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
   * ClauseClassificationRepository#markFailed).
   */
  async markFailed(id: string, errorMessage: string): Promise<RiskDetection> {
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
   * ClauseClassificationRepository#applyTransition.
   */
  private async applyTransition(
    id: string,
    patch: Partial<Omit<RiskDetection, 'id' | 'document_analysis_id' | 'created_at'>>,
  ): Promise<RiskDetection> {
    const { data, error } = await this.supabase
      .from('risk_detections')
      .update(patch as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update risk detection status', error, {
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
   * Single point of conversion from a raw risk_detections row (result:
   * generic Postgrest Json) to the validated RiskDetection domain type
   * (result: RiskDetectionResult | null). Throws DatabaseError, not a
   * raw ZodError, on mismatch — same classification as
   * ClauseClassificationRepository#parseRow: a persisted result failing
   * schema validation is a data-integrity problem, not a normal
   * not-found/bad-request case.
   */
  private parseRow(row: RiskDetectionRow): RiskDetection {
    if (row.result === null) {
      return { ...row, result: null };
    }

    const parsed = riskDetectionResultSchema.safeParse(row.result);

    if (!parsed.success) {
      throw new DatabaseError(
        'risk_detections row contains a result that does not match the expected schema',
        parsed.error,
        { table: this.tableName, id: row.id },
      );
    }

    return { ...row, result: parsed.data };
  }
}

export type { CreateRiskDetectionInput } from '@/modules/risk-detection/risk-detection.entity';