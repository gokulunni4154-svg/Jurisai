// src/modules/missing-clause-detection/missing-clause-detection.repository.ts
// File 111 — JurisAI Missing Clause Detection module

import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';
import {
  missingClauseDetectionResultSchema,
  type MissingClauseDetectionResult,
} from '@/modules/missing-clause-detection/missing-clause-detection.schemas';
import type { MissingClauseDetection } from '@/modules/missing-clause-detection/missing-clause-detection.entity';

type MissingClauseDetectionRow = Database['public']['Tables']['missing_clause_detections']['Row'];

/**
 * Repository for the missing_clause_detections table (File 108
 * migration, which — like risk_detections' File 100 and unlike
 * clause_classifications' original File 92 — already shipped with its
 * write policies included from the start; see File 108's own KEY
 * DECISION comment).
 *
 * findById/findByIdOrThrow are overridden — identical rationale to
 * RiskDetectionRepository's (File 103) and
 * ClauseClassificationRepository's (File 95, Amendment #1):
 * TypeScript resolves `this.findById` polymorphically even inside the
 * base class's own findByIdOrThrow, so overriding only findById would
 * let findByIdOrThrow silently call the override at runtime while
 * staying *declared* as returning the base Row type. Both are fully
 * reimplemented here rather than calling super, closing that gap
 * directly rather than partially — same as File 103, and built in from
 * the start here rather than needing a follow-up amendment the way File
 * 95 did.
 */
export class MissingClauseDetectionRepository extends BaseRepository<'missing_clause_detections'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'missing_clause_detections');
  }

  /**
   * Overrides BaseRepository#findById. Routes the row through parseRow()
   * so `result` is validated against missingClauseDetectionResultSchema
   * instead of trusted as an opaque Json blob — same reasoning as
   * RiskDetectionRepository#findById.
   */
  override async findById(id: string): Promise<MissingClauseDetection | null> {
    const { data, error } = await this.supabase
      .from('missing_clause_detections')
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
   * MissingClauseDetection type flows through consistently.
   */
  override async findByIdOrThrow(id: string): Promise<MissingClauseDetection> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return row;
  }

  /**
   * Returns every missing clause detection run for a given analysis,
   * most recent first. Plural by design — document_analysis_id is
   * intentionally NOT unique on this table (File 108), same reasoning
   * as risk_detections and clause_classifications: independent re-runs
   * of missing clause detection against the same analysis are a
   * first-class part of this module's lifecycle, not an anomaly.
   */
  async findByDocumentAnalysisId(documentAnalysisId: string): Promise<MissingClauseDetection[]> {
    const { data, error } = await this.supabase
      .from('missing_clause_detections')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list missing_clause_detections by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * Returns the most recent missing clause detection run for a given
   * analysis, or null if none exists yet. This is the method the
   * service layer is expected to use for "what's the current missing
   * clause detection" reads — findByDocumentAnalysisId is for surfacing
   * run history, not the common-path read. Identical purpose to
   * RiskDetectionRepository#findLatestByDocumentAnalysisId.
   */
  async findLatestByDocumentAnalysisId(
    documentAnalysisId: string,
  ): Promise<MissingClauseDetection | null> {
    const { data, error } = await this.supabase
      .from('missing_clause_detections')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find latest missing_clause_detection by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return data ? this.parseRow(data) : null;
  }

  /**
   * Transitions a missing clause detection run from 'pending' to
   * 'processing'. Same purpose as
   * RiskDetectionRepository#markProcessing — lets a caller polling the
   * row distinguish "queued" from "actually running".
   */
  async markProcessing(id: string): Promise<MissingClauseDetection> {
    return this.applyTransition(id, { status: 'processing' });
  }

  /**
   * Transitions to 'completed', recording the result, which provider
   * produced it, and completed_at — all three required together, same
   * reasoning as RiskDetectionRepository#markCompleted: a 'completed'
   * row with a null result is a state downstream consumers have no
   * valid way to handle.
   */
  async markCompleted(
    id: string,
    result: MissingClauseDetectionResult,
    providerUsed: AIProviderName,
  ): Promise<MissingClauseDetection> {
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
   * RiskDetectionRepository#markFailed).
   */
  async markFailed(id: string, errorMessage: string): Promise<MissingClauseDetection> {
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
   * RiskDetectionRepository#applyTransition.
   */
  private async applyTransition(
    id: string,
    patch: Partial<
      Omit<MissingClauseDetection, 'id' | 'document_analysis_id' | 'created_at'>
    >,
  ): Promise<MissingClauseDetection> {
    const { data, error } = await this.supabase
      .from('missing_clause_detections')
      .update(patch as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update missing clause detection status', error, {
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
   * Single point of conversion from a raw missing_clause_detections row
   * (result: generic Postgrest Json) to the validated
   * MissingClauseDetection domain type (result:
   * MissingClauseDetectionResult | null). Throws DatabaseError, not a
   * raw ZodError, on mismatch — same classification as
   * RiskDetectionRepository#parseRow: a persisted result failing schema
   * validation is a data-integrity problem, not a normal
   * not-found/bad-request case.
   */
  private parseRow(row: MissingClauseDetectionRow): MissingClauseDetection {
    if (row.result === null) {
      return { ...row, result: null };
    }

    const parsed = missingClauseDetectionResultSchema.safeParse(row.result);

    if (!parsed.success) {
      throw new DatabaseError(
        'missing_clause_detections row contains a result that does not match the expected schema',
        parsed.error,
        { table: this.tableName, id: row.id },
      );
    }

    return { ...row, result: parsed.data };
  }
}

export type { CreateMissingClauseDetectionInput } from '@/modules/missing-clause-detection/missing-clause-detection.entity';