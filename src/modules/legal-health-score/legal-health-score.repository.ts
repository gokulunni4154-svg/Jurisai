// src/modules/legal-health-score/legal-health-score.repository.ts
// File 135 — JurisAI Legal Health Score module

import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';
import {
  legalHealthScoreResultSchema,
  categoryScoresSchema,
  type LegalHealthScoreResult,
  type CategoryScores,
} from '@/modules/legal-health-score/legal-health-score.schemas';
import type { LegalHealthScore } from '@/modules/legal-health-score/legal-health-score.entity';

type LegalHealthScoreRow = Database['public']['Tables']['legal_health_scores']['Row'];

/**
 * Repository for the legal_health_scores table (File 132 migration,
 * which — like ai_recommendations' File 124, compliance_detections' File
 * 116, missing_clause_detections' File 108, and risk_detections' File
 * 100 — shipped with its write policies included from the start; see
 * File 132's own KEY DECISION comment).
 *
 * findById/findByIdOrThrow are overridden — identical rationale to
 * AIRecommendationRepository's (File 127),
 * ComplianceDetectionRepository's (File 119),
 * MissingClauseDetectionRepository's (File 111), and
 * RiskDetectionRepository's (File 103): TypeScript resolves
 * `this.findById` polymorphically even inside the base class's own
 * findByIdOrThrow, so overriding only findById would let
 * findByIdOrThrow silently call the override at runtime while staying
 * *declared* as returning the base Row type. Both are fully
 * reimplemented here rather than calling super, same as all four prior
 * modules.
 *
 * Per File 132's KEY DECISION, this repository has no method that
 * accepts or filters by any of the five upstream modules' own row IDs
 * (clause_classification_id, risk_detection_id,
 * missing_clause_detection_id, compliance_detection_id,
 * ai_recommendation_id) — only document_analysis_id. The Service layer
 * is expected to fetch each upstream module's latest-completed row
 * independently, via each of their own
 * getLatestCompletedXForAnalysis()-style methods, not via anything
 * exposed here.
 *
 * NEW, no precedent in any prior repository — this table has TWO jsonb
 * columns requiring schema validation on read (`result` and
 * `category_scores`), not one, plus a plain promoted `overall_score`
 * integer needing no validation at all. parseRow() below validates
 * `result` and `category_scores` independently rather than assuming one
 * being valid implies the other is, since nothing at the database level
 * enforces they were ever written together (see File 132's stated
 * duplication trade-off).
 */
export interface LegalHealthScoreAdminDocumentInfo {
  document_id: string;
  documents: { title: string; owner_id: string } | null;
}

export type LegalHealthScoreWithDocumentInfo = LegalHealthScore & {
  document_analyses: LegalHealthScoreAdminDocumentInfo | null;
};

export class LegalHealthScoreRepository extends BaseRepository<'legal_health_scores'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'legal_health_scores');
  }

  /**
   * Overrides BaseRepository#findById. Routes the row through parseRow()
   * so `result` and `category_scores` are validated against their
   * respective schemas instead of trusted as opaque Json blobs — same
   * reasoning as AIRecommendationRepository#findById,
   * ComplianceDetectionRepository#findById, and
   * RiskDetectionRepository#findById.
   */
  override async findById(id: string): Promise<LegalHealthScore | null> {
    const { data, error } = await this.supabase
      .from('legal_health_scores')
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
   * LegalHealthScore type flows through consistently.
   */
  override async findByIdOrThrow(id: string): Promise<LegalHealthScore> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return row;
  }

  /**
   * Returns every legal health score run for a given analysis, most
   * recent first. Plural by design — document_analysis_id is
   * intentionally NOT unique on this table (File 132), same reasoning as
   * ai_recommendations, compliance_detections, missing_clause_detections,
   * and risk_detections: independent re-runs of this engine against the
   * same analysis are a first-class part of this module's lifecycle
   * (e.g. after any upstream module re-runs), not an anomaly.
   */
  async findByDocumentAnalysisId(documentAnalysisId: string): Promise<LegalHealthScore[]> {
    const { data, error } = await this.supabase
      .from('legal_health_scores')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list legal_health_scores by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * Returns the most recent legal health score run for a given analysis,
   * or null if none exists yet. This is the method the service layer is
   * expected to use for "what's the current health score" reads —
   * findByDocumentAnalysisId is for surfacing run history, not the
   * common-path read. Identical purpose to
   * AIRecommendationRepository#findLatestByDocumentAnalysisId,
   * ComplianceDetectionRepository#findLatestByDocumentAnalysisId,
   * MissingClauseDetectionRepository#findLatestByDocumentAnalysisId, and
   * RiskDetectionRepository#findLatestByDocumentAnalysisId.
   */
  async findLatestByDocumentAnalysisId(
    documentAnalysisId: string,
  ): Promise<LegalHealthScore | null> {
    const { data, error } = await this.supabase
      .from('legal_health_scores')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find latest legal_health_score by document_analysis_id',
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
   * returns every legal health score run across all of them, routed
   * through parseRow() — which, unlike the other seven modules,
   * independently validates both `result` and `category_scores` per row
   * here, same as every other read path on this class.
   *
   * Returns an empty array (not an error) when `documentAnalysisIds` is
   * empty, matching Postgrest's own `.in()` semantics.
   */
  async findManyForAnalysisIds(documentAnalysisIds: string[]): Promise<LegalHealthScore[]> {
    if (documentAnalysisIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('legal_health_scores')
      .select('*')
      .in('document_analysis_id', documentAnalysisIds);

    if (error) {
      throw new DatabaseError(
        'Failed to find legal_health_scores for document_analysis ids',
        error,
        { table: this.tableName, documentAnalysisIds },
      );
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * NEW — added for the Observability module (Phase 3), admin view.
   * Same purpose and shape as RiskDetectionRepository#findManyForAdminView
   * — single embedded call (legal_health_scores -> document_analyses ->
   * documents), no firm filter, admin-client-only. FKs confirmed this
   * session against database.types.ts. Same parseRow() reused here as
   * every other read path on this class — validates both `result` and
   * `category_scores` independently, per this class's own established
   * two-column parsing pattern.
   */
  async findManyForAdminView(): Promise<LegalHealthScoreWithDocumentInfo[]> {
    const { data, error } = await this.supabase
      .from('legal_health_scores')
      .select('*, document_analyses(document_id, documents(title, owner_id))');

    if (error) {
      throw new DatabaseError('Failed to list legal_health_scores for admin view', error, {
        table: this.tableName,
      });
    }

    return (data ?? []).map((row) => {
      const { document_analyses, ...rest } = row as LegalHealthScoreRow & {
        document_analyses: LegalHealthScoreAdminDocumentInfo | null;
      };
      return {
        ...this.parseRow(rest as LegalHealthScoreRow),
        document_analyses,
      };
    });
  }

  /**
   * Transitions a legal health score run from 'pending' to 'processing'.
   * Same purpose as every prior module's markProcessing — lets a caller
   * polling the row distinguish "queued" from "actually running".
   */
  async markProcessing(id: string): Promise<LegalHealthScore> {
    return this.applyTransition(id, { status: 'processing' });
  }

  /**
   * Transitions to 'completed', recording the result, the derived
   * category scores, the derived overall score, which provider produced
   * it, and completed_at — all required together.
   *
   * NEW, no precedent in any prior module's markCompleted — THREE
   * result-shaped arguments instead of one: `result`
   * (LegalHealthScoreResult), `categoryScores` (CategoryScores), and
   * `overallScore` (plain number). Every prior module's markCompleted
   * took a single validated result object because every prior module had
   * only one jsonb column to populate. This table's promoted
   * `overall_score` and `category_scores` columns (File 132's KEY
   * DECISION) must land in the same transition as `result`, so the
   * caller (the Service layer, File 137) is required to supply all
   * three explicitly rather than this method silently re-deriving
   * categoryScores/overallScore from result itself — keeping the
   * derivation logic in one place (the Service layer) rather than
   * duplicating it here.
   */
  async markCompleted(
    id: string,
    result: LegalHealthScoreResult,
    categoryScores: CategoryScores,
    overallScore: number,
    providerUsed: AIProviderName,
  ): Promise<LegalHealthScore> {
    return this.applyTransition(id, {
      status: 'completed',
      result,
      category_scores: categoryScores,
      overall_score: overallScore,
      provider_used: providerUsed,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Transitions to 'failed', recording a user-safe message (sanitization
   * is the Service layer's job, same division of responsibility as every
   * prior module's markFailed).
   */
  async markFailed(id: string, errorMessage: string): Promise<LegalHealthScore> {
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
   * every prior module's applyTransition.
   */
  private async applyTransition(
    id: string,
    patch: Partial<
      Omit<LegalHealthScore, 'id' | 'document_analysis_id' | 'created_at'>
    >,
  ): Promise<LegalHealthScore> {
    const { data, error } = await this.supabase
      .from('legal_health_scores')
      .update(patch as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update legal health score status', error, {
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
   * Single point of conversion from a raw legal_health_scores row
   * (result, category_scores: generic Postgrest Json) to the validated
   * LegalHealthScore domain type (result: LegalHealthScoreResult | null,
   * category_scores: CategoryScores | null). Throws DatabaseError, not a
   * raw ZodError, on mismatch — same classification as every prior
   * module's parseRow: a persisted value failing schema validation is a
   * data-integrity problem, not a normal not-found/bad-request case.
   *
   * NEW, no precedent in any prior module's parseRow — validates TWO
   * independent jsonb columns rather than one, and does so separately:
   * a failure in `category_scores` does not short-circuit validation of
   * `result`, and vice versa, so a DatabaseError's message and cause
   * always point at the specific column that actually failed.
   * `overall_score` needs no parsing — it is a plain nullable integer
   * column, passed through as-is.
   */
  private parseRow(row: LegalHealthScoreRow): LegalHealthScore {
    let parsedResult: LegalHealthScoreResult | null = null;
    if (row.result !== null) {
      const parsed = legalHealthScoreResultSchema.safeParse(row.result);
      if (!parsed.success) {
        throw new DatabaseError(
          'legal_health_scores row contains a result that does not match the expected schema',
          parsed.error,
          { table: this.tableName, id: row.id },
        );
      }
      parsedResult = parsed.data;
    }

    let parsedCategoryScores: CategoryScores | null = null;
    if (row.category_scores !== null) {
      const parsed = categoryScoresSchema.safeParse(row.category_scores);
      if (!parsed.success) {
        throw new DatabaseError(
          'legal_health_scores row contains category_scores that do not match the expected schema',
          parsed.error,
          { table: this.tableName, id: row.id },
        );
      }
      parsedCategoryScores = parsed.data;
    }

    return {
      ...row,
      result: parsedResult,
      category_scores: parsedCategoryScores,
    };
  }
}

export type { CreateLegalHealthScoreInput } from '@/modules/legal-health-score/legal-health-score.entity';