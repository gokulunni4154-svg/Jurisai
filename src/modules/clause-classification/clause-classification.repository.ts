// src/modules/clause-classification/clause-classification.repository.ts
// File 95 — JurisAI Clause Classification module
// AMENDMENT 1: adds parseRow() validation on reads and the
// markProcessing/markCompleted/markFailed transition methods, mirroring
// DocumentAnalysisRepository (File 64) exactly. These were missing from
// the original File 95 — flagged and closed before the Service layer
// (File 96), which depends on the transition methods, could be built.

import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';
import {
  clauseClassificationResultSchema,
  type ClauseClassificationResult,
} from '@/modules/clause-classification/clause-classification.schemas';
import type { ClauseClassification } from '@/modules/clause-classification/clause-classification.entity';

type ClauseClassificationRow = Database['public']['Tables']['clause_classifications']['Row'];

/**
 * Repository for the clause_classifications table (File 92 migration,
 * amended by the 20260715055158 write-policy migration).
 *
 * findById/findByIdOrThrow are overridden — same rationale as
 * DocumentAnalysisRepository's amendment: TypeScript resolves
 * `this.findById` polymorphically even inside the base class's own
 * findByIdOrThrow, so overriding only findById would let
 * findByIdOrThrow silently call the override at runtime while staying
 * *declared* as returning the base Row type. Both are fully
 * reimplemented here rather than calling super, closing that gap
 * directly rather than partially.
 */
export class ClauseClassificationRepository extends BaseRepository<'clause_classifications'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'clause_classifications');
  }

  /**
   * AMENDMENT: overrides BaseRepository#findById. Routes the row through
   * parseRow() so `result` is validated against
   * clauseClassificationResultSchema instead of trusted as an opaque
   * Json blob — same reasoning as DocumentAnalysisRepository#findById.
   */
  override async findById(id: string): Promise<ClauseClassification | null> {
    const { data, error } = await this.supabase
      .from('clause_classifications')
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
   * AMENDMENT: overrides BaseRepository#findByIdOrThrow. Calls this
   * class's own findById() override (not super's), so the validated
   * ClauseClassification type flows through consistently.
   */
  override async findByIdOrThrow(id: string): Promise<ClauseClassification> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return row;
  }

  /**
   * Returns every classification run for a given analysis, most recent
   * first. Plural by design — document_analysis_id is intentionally NOT
   * unique on this table (File 92), since re-classification independent
   * of re-analysis is a first-class part of this module's lifecycle.
   */
  async findByDocumentAnalysisId(documentAnalysisId: string): Promise<ClauseClassification[]> {
    const { data, error } = await this.supabase
      .from('clause_classifications')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list clause_classifications by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * Returns the most recent classification run for a given analysis, or
   * null if none exists yet. This is the method the service layer is
   * expected to use for "what's the current classification" reads —
   * findByDocumentAnalysisId is for surfacing classification history,
   * not the common-path read.
   */
  async findLatestByDocumentAnalysisId(
    documentAnalysisId: string,
  ): Promise<ClauseClassification | null> {
    const { data, error } = await this.supabase
      .from('clause_classifications')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find latest clause_classification by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return data ? this.parseRow(data) : null;
  }

  /**
   * AMENDMENT: new. Transitions a classification run from 'pending' to
   * 'processing'. Same purpose as DocumentAnalysisRepository#markProcessing
   * — lets a caller polling the row distinguish "queued" from "actually
   * running".
   */
  async markProcessing(id: string): Promise<ClauseClassification> {
    return this.applyTransition(id, { status: 'processing' });
  }

  /**
   * AMENDMENT: new. Transitions to 'completed', recording the result,
   * which provider produced it, and completed_at — all three required
   * together, same reasoning as DocumentAnalysisRepository#markCompleted:
   * a 'completed' row with a null result is a state downstream consumers
   * (Risk Detection, etc.) have no valid way to handle.
   */
  async markCompleted(
    id: string,
    result: ClauseClassificationResult,
    providerUsed: AIProviderName,
  ): Promise<ClauseClassification> {
    return this.applyTransition(id, {
      status: 'completed',
      result,
      provider_used: providerUsed,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * AMENDMENT: new. Transitions to 'failed', recording a user-safe
   * message (sanitization is the Service layer's job, same division of
   * responsibility as DocumentAnalysisRepository#markFailed).
   */
  async markFailed(id: string, errorMessage: string): Promise<ClauseClassification> {
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
   * DocumentAnalysisRepository#applyTransition.
   */
  private async applyTransition(
    id: string,
    patch: Partial<Omit<ClauseClassification, 'id' | 'document_analysis_id' | 'created_at'>>,
  ): Promise<ClauseClassification> {
    const { data, error } = await this.supabase
      .from('clause_classifications')
      .update(patch as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update clause classification status', error, {
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
   * AMENDMENT: new. Single point of conversion from a raw
   * clause_classifications row (result: generic Postgrest Json) to the
   * validated ClauseClassification domain type (result:
   * ClauseClassificationResult | null). Throws DatabaseError, not a raw
   * ZodError, on mismatch — same classification as
   * DocumentAnalysisRepository#parseRow: a persisted result failing
   * schema validation is a data-integrity problem, not a normal
   * not-found/bad-request case.
   */
  private parseRow(row: ClauseClassificationRow): ClauseClassification {
    if (row.result === null) {
      return { ...row, result: null };
    }

    const parsed = clauseClassificationResultSchema.safeParse(row.result);

    if (!parsed.success) {
      throw new DatabaseError(
        'clause_classifications row contains a result that does not match the expected schema',
        parsed.error,
        { table: this.tableName, id: row.id },
      );
    }

    return { ...row, result: parsed.data };
  }
}

export type { CreateClauseClassificationInput } from '@/modules/clause-classification/clause-classification.entity';