// src/modules/ai-recommendation/ai-recommendation.repository.ts
// File 127 — JurisAI AI Recommendation module

import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';
import {
  aiRecommendationResultSchema,
  type AIRecommendationResult,
} from '@/modules/ai-recommendation/ai-recommendation.schemas';
import type { AIRecommendation } from '@/modules/ai-recommendation/ai-recommendation.entity';

type AIRecommendationRow = Database['public']['Tables']['ai_recommendations']['Row'];

/**
 * Repository for the ai_recommendations table (File 124 migration, which
 * — like risk_detections' File 100, missing_clause_detections' File 108,
 * and compliance_detections' File 116, and unlike clause_classifications'
 * original File 92 — already shipped with its write policies included
 * from the start; see File 124's own KEY DECISION comment).
 *
 * findById/findByIdOrThrow are overridden — identical rationale to
 * ComplianceDetectionRepository's (File 119),
 * MissingClauseDetectionRepository's (File 111), and
 * RiskDetectionRepository's (File 103): TypeScript resolves
 * `this.findById` polymorphically even inside the base class's own
 * findByIdOrThrow, so overriding only findById would let
 * findByIdOrThrow silently call the override at runtime while staying
 * *declared* as returning the base Row type. Both are fully
 * reimplemented here rather than calling super, closing that gap
 * directly rather than partially — same as Files 119, 111, and 103, and
 * built in from the start here rather than needing a follow-up
 * amendment the way File 95 originally did.
 *
 * Per File 124's KEY DECISION, this repository has no method that
 * accepts or filters by any upstream detection module's own row ID
 * (risk_detection_id, missing_clause_detection_id,
 * compliance_detection_id, clause_classification_id) — only
 * document_analysis_id. The Service layer is expected to fetch each
 * upstream module's latest-completed row independently, via each of
 * their own getLatestCompletedXForAnalysis()-style methods, not via
 * anything exposed here.
 */
export interface AIRecommendationAdminDocumentInfo {
  document_id: string;
  documents: { title: string; owner_id: string } | null;
}

export type AIRecommendationWithDocumentInfo = AIRecommendation & {
  document_analyses: AIRecommendationAdminDocumentInfo | null;
};

export class AIRecommendationRepository extends BaseRepository<'ai_recommendations'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'ai_recommendations');
  }

  /**
   * Overrides BaseRepository#findById. Routes the row through parseRow()
   * so `result` is validated against aiRecommendationResultSchema
   * instead of trusted as an opaque Json blob — same reasoning as
   * ComplianceDetectionRepository#findById and
   * RiskDetectionRepository#findById.
   */
  override async findById(id: string): Promise<AIRecommendation | null> {
    const { data, error } = await this.supabase
      .from('ai_recommendations')
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
   * AIRecommendation type flows through consistently.
   */
  override async findByIdOrThrow(id: string): Promise<AIRecommendation> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return row;
  }

  /**
   * Returns every AI recommendation run for a given analysis, most
   * recent first. Plural by design — document_analysis_id is
   * intentionally NOT unique on this table (File 124), same reasoning
   * as compliance_detections, missing_clause_detections, and
   * risk_detections: independent re-runs of the recommendation engine
   * against the same analysis are a first-class part of this module's
   * lifecycle (e.g. after any upstream module re-runs), not an anomaly.
   */
  async findByDocumentAnalysisId(documentAnalysisId: string): Promise<AIRecommendation[]> {
    const { data, error } = await this.supabase
      .from('ai_recommendations')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list ai_recommendations by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * Returns the most recent AI recommendation run for a given analysis,
   * or null if none exists yet. This is the method the service layer is
   * expected to use for "what's the current recommendation set" reads —
   * findByDocumentAnalysisId is for surfacing run history, not the
   * common-path read. Identical purpose to
   * ComplianceDetectionRepository#findLatestByDocumentAnalysisId,
   * MissingClauseDetectionRepository#findLatestByDocumentAnalysisId, and
   * RiskDetectionRepository#findLatestByDocumentAnalysisId.
   */
  async findLatestByDocumentAnalysisId(
    documentAnalysisId: string,
  ): Promise<AIRecommendation | null> {
    const { data, error } = await this.supabase
      .from('ai_recommendations')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find latest ai_recommendation by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return data ? this.parseRow(data) : null;
  }

  /**
   * NEW — added for the Observability module (Phase 3). Same purpose
   * and shape as RiskDetectionRepository#findManyForAnalysisIds — the
   * fourth of four sequential hops in Observability's firm-scoped query
   * path, this repo being one of the eight module repos at the end of
   * the chain. Given document_analysis ids already resolved upstream,
   * returns every AI recommendation run across all of them, routed
   * through parseRow() same as every other read path on this class.
   *
   * Returns an empty array (not an error) when `documentAnalysisIds` is
   * empty, matching Postgrest's own `.in()` semantics.
   */
  async findManyForAnalysisIds(documentAnalysisIds: string[]): Promise<AIRecommendation[]> {
    if (documentAnalysisIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('ai_recommendations')
      .select('*')
      .in('document_analysis_id', documentAnalysisIds);

    if (error) {
      throw new DatabaseError(
        'Failed to find ai_recommendations for document_analysis ids',
        error,
        { table: this.tableName, documentAnalysisIds },
      );
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * NEW — added for the Observability module (Phase 3), admin view.
   * Same purpose and shape as RiskDetectionRepository#findManyForAdminView
   * — single embedded call (ai_recommendations -> document_analyses ->
   * documents), no firm filter, admin-client-only. FKs confirmed this
   * session against database.types.ts.
   */
  async findManyForAdminView(): Promise<AIRecommendationWithDocumentInfo[]> {
    const { data, error } = await this.supabase
      .from('ai_recommendations')
      .select('*, document_analyses(document_id, documents(title, owner_id))');

    if (error) {
      throw new DatabaseError('Failed to list ai_recommendations for admin view', error, {
        table: this.tableName,
      });
    }

    return (data ?? []).map((row) => {
      const { document_analyses, ...rest } = row as AIRecommendationRow & {
        document_analyses: AIRecommendationAdminDocumentInfo | null;
      };
      return {
        ...this.parseRow(rest as AIRecommendationRow),
        document_analyses,
      };
    });
  }

  /**
   * Transitions an AI recommendation run from 'pending' to 'processing'.
   * Same purpose as ComplianceDetectionRepository#markProcessing — lets
   * a caller polling the row distinguish "queued" from "actually
   * running".
   */
  async markProcessing(id: string): Promise<AIRecommendation> {
    return this.applyTransition(id, { status: 'processing' });
  }

  /**
   * Transitions to 'completed', recording the result, which provider
   * produced it, and completed_at — all three required together, same
   * reasoning as ComplianceDetectionRepository#markCompleted: a
   * 'completed' row with a null result is a state downstream consumers
   * have no valid way to handle.
   */
  async markCompleted(
    id: string,
    result: AIRecommendationResult,
    providerUsed: AIProviderName,
  ): Promise<AIRecommendation> {
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
   * ComplianceDetectionRepository#markFailed).
   */
  async markFailed(id: string, errorMessage: string): Promise<AIRecommendation> {
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
   * ComplianceDetectionRepository#applyTransition.
   */
  private async applyTransition(
    id: string,
    patch: Partial<
      Omit<AIRecommendation, 'id' | 'document_analysis_id' | 'created_at'>
    >,
  ): Promise<AIRecommendation> {
    const { data, error } = await this.supabase
      .from('ai_recommendations')
      .update(patch as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update AI recommendation status', error, {
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
   * Single point of conversion from a raw ai_recommendations row
   * (result: generic Postgrest Json) to the validated AIRecommendation
   * domain type (result: AIRecommendationResult | null). Throws
   * DatabaseError, not a raw ZodError, on mismatch — same classification
   * as ComplianceDetectionRepository#parseRow and
   * RiskDetectionRepository#parseRow: a persisted result failing schema
   * validation is a data-integrity problem, not a normal
   * not-found/bad-request case.
   */
  private parseRow(row: AIRecommendationRow): AIRecommendation {
    if (row.result === null) {
      return { ...row, result: null };
    }

    const parsed = aiRecommendationResultSchema.safeParse(row.result);

    if (!parsed.success) {
      throw new DatabaseError(
        'ai_recommendations row contains a result that does not match the expected schema',
        parsed.error,
        { table: this.tableName, id: row.id },
      );
    }

    return { ...row, result: parsed.data };
  }
}

export type { CreateAIRecommendationInput } from '@/modules/ai-recommendation/ai-recommendation.entity';