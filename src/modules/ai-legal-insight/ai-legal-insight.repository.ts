// src/modules/ai-legal-insight/ai-legal-insight.repository.ts
// File 143 — JurisAI AI Legal Insight module

import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';
import {
  aiLegalInsightResultSchema,
  type AiLegalInsightResult,
} from '@/modules/ai-legal-insight/ai-legal-insight.schemas';
import type { AiLegalInsight } from '@/modules/ai-legal-insight/ai-legal-insight.entity';

type AiLegalInsightRow = Database['public']['Tables']['ai_legal_insights']['Row'];

/**
 * Repository for the ai_legal_insights table (File 140 migration, as
 * corrected by Amendment #1 — the originally-included `source_modules`
 * column was dropped; see the Amendment's docstring for the full
 * account). Like ai_recommendations' File 124, legal_health_scores' File
 * 132, compliance_detections' File 116, missing_clause_detections' File
 * 108, and risk_detections' File 100, this table shipped with its write
 * policies included from the start (see File 140's own KEY DECISION
 * comment).
 *
 * findById/findByIdOrThrow are overridden — identical rationale to
 * LegalHealthScoreRepository's (File 135),
 * AIRecommendationRepository's (File 127),
 * ComplianceDetectionRepository's (File 119),
 * MissingClauseDetectionRepository's (File 111), and
 * RiskDetectionRepository's (File 103): TypeScript resolves
 * `this.findById` polymorphically even inside the base class's own
 * findByIdOrThrow, so overriding only findById would let
 * findByIdOrThrow silently call the override at runtime while staying
 * *declared* as returning the base Row type. Both are fully
 * reimplemented here rather than calling super, same as all five prior
 * modules.
 *
 * Per File 140's KEY DECISION, this repository has no method that
 * accepts or filters by any of the six upstream modules' own row IDs
 * (clause_classification_id, risk_detection_id,
 * missing_clause_detection_id, compliance_detection_id,
 * ai_recommendation_id, legal_health_score_id) — only
 * document_analysis_id. The Service layer is expected to fetch each
 * upstream module's latest-completed row independently, via each of
 * their own getLatestCompletedXForAnalysis()-style methods, not via
 * anything exposed here.
 *
 * Structurally, this repository follows AIRecommendationRepository
 * (File 127) rather than LegalHealthScoreRepository (File 135): a single
 * jsonb `result` column requiring validation, no promoted scalar
 * columns, no second jsonb column. File 135's two-column,
 * three-argument markCompleted() does not apply here — that shape was
 * specific to legal_health_scores' promoted overall_score/category_scores
 * columns (File 132's KEY DECISION), which this table deliberately does
 * not have (File 140's KEY DECISION) and never had a
 * source_modules-shaped analogue either, once Amendment #1 corrected the
 * original migration.
 */
export interface AiLegalInsightAdminDocumentInfo {
  document_id: string;
  documents: { title: string; owner_id: string } | null;
}

export type AiLegalInsightWithDocumentInfo = AiLegalInsight & {
  document_analyses: AiLegalInsightAdminDocumentInfo | null;
};

export class AiLegalInsightRepository extends BaseRepository<'ai_legal_insights'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'ai_legal_insights');
  }

  /**
   * Overrides BaseRepository#findById. Routes the row through parseRow()
   * so `result` is validated against aiLegalInsightResultSchema instead
   * of trusted as an opaque Json blob — same reasoning as
   * LegalHealthScoreRepository#findById,
   * AIRecommendationRepository#findById,
   * ComplianceDetectionRepository#findById, and
   * RiskDetectionRepository#findById.
   */
  override async findById(id: string): Promise<AiLegalInsight | null> {
    const { data, error } = await this.supabase
      .from('ai_legal_insights')
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
   * findById() override (not super's), so the validated AiLegalInsight
   * type flows through consistently.
   */
  override async findByIdOrThrow(id: string): Promise<AiLegalInsight> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return row;
  }

  /**
   * Returns every AI Legal Insights run for a given analysis, most
   * recent first. Plural by design — document_analysis_id is
   * intentionally NOT unique on this table (File 140), same reasoning as
   * legal_health_scores, ai_recommendations, compliance_detections,
   * missing_clause_detections, and risk_detections: independent re-runs
   * of this module against the same analysis are a first-class part of
   * its lifecycle (e.g. after any upstream module re-runs), not an
   * anomaly. Note: recalculation semantics for this module were an
   * assumption (not explicitly re-confirmed) as of File 140 — see that
   * file's flagged open item.
   */
  async findByDocumentAnalysisId(documentAnalysisId: string): Promise<AiLegalInsight[]> {
    const { data, error } = await this.supabase
      .from('ai_legal_insights')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list ai_legal_insights by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * Returns the most recent AI Legal Insights run for a given analysis,
   * or null if none exists yet. This is the method the service layer is
   * expected to use for "what are the current insights" reads —
   * findByDocumentAnalysisId is for surfacing run history, not the
   * common-path read. Identical purpose to
   * LegalHealthScoreRepository#findLatestByDocumentAnalysisId,
   * AIRecommendationRepository#findLatestByDocumentAnalysisId,
   * ComplianceDetectionRepository#findLatestByDocumentAnalysisId,
   * MissingClauseDetectionRepository#findLatestByDocumentAnalysisId, and
   * RiskDetectionRepository#findLatestByDocumentAnalysisId.
   */
  async findLatestByDocumentAnalysisId(
    documentAnalysisId: string,
  ): Promise<AiLegalInsight | null> {
    const { data, error } = await this.supabase
      .from('ai_legal_insights')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find latest ai_legal_insight by document_analysis_id',
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
   * returns every AI Legal Insights run across all of them, routed
   * through parseRow() same as every other read path on this class.
   *
   * Returns an empty array (not an error) when `documentAnalysisIds` is
   * empty, matching Postgrest's own `.in()` semantics.
   */
  async findManyForAnalysisIds(documentAnalysisIds: string[]): Promise<AiLegalInsight[]> {
    if (documentAnalysisIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('ai_legal_insights')
      .select('*')
      .in('document_analysis_id', documentAnalysisIds);

    if (error) {
      throw new DatabaseError(
        'Failed to find ai_legal_insights for document_analysis ids',
        error,
        { table: this.tableName, documentAnalysisIds },
      );
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * NEW — added for the Observability module (Phase 3), admin view.
   * Same purpose and shape as RiskDetectionRepository#findManyForAdminView
   * — single embedded call (ai_legal_insights -> document_analyses ->
   * documents), no firm filter, admin-client-only. FKs confirmed this
   * session against database.types.ts.
   */
  async findManyForAdminView(): Promise<AiLegalInsightWithDocumentInfo[]> {
    const { data, error } = await this.supabase
      .from('ai_legal_insights')
      .select('*, document_analyses(document_id, documents(title, owner_id))');

    if (error) {
      throw new DatabaseError('Failed to list ai_legal_insights for admin view', error, {
        table: this.tableName,
      });
    }

    return (data ?? []).map((row) => {
      const { document_analyses, ...rest } = row as AiLegalInsightRow & {
        document_analyses: AiLegalInsightAdminDocumentInfo | null;
      };
      return {
        ...this.parseRow(rest as AiLegalInsightRow),
        document_analyses,
      };
    });
  }

  /**
   * Transitions an AI Legal Insights run from 'pending' to 'processing'.
   * Same purpose as every prior module's markProcessing — lets a caller
   * polling the row distinguish "queued" from "actually running".
   */
  async markProcessing(id: string): Promise<AiLegalInsight> {
    return this.applyTransition(id, { status: 'processing' });
  }

  /**
   * Transitions to 'completed', recording the result, which provider
   * produced it, and completed_at — all three required together, same
   * reasoning as AIRecommendationRepository#markCompleted. Single
   * result-shaped argument, not three (unlike
   * LegalHealthScoreRepository#markCompleted) — this table has no
   * promoted scalar/second-jsonb columns to populate alongside `result`.
   */
  async markCompleted(
    id: string,
    result: AiLegalInsightResult,
    providerUsed: AIProviderName,
  ): Promise<AiLegalInsight> {
    return this.applyTransition(id, {
      status: 'completed',
      result,
      provider_used: providerUsed,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Transitions to 'failed', recording a user-safe message (sanitization
   * is the Service layer's job, same division of responsibility as every
   * prior module's markFailed).
   */
  async markFailed(id: string, errorMessage: string): Promise<AiLegalInsight> {
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
      Omit<AiLegalInsight, 'id' | 'document_analysis_id' | 'created_at'>
    >,
  ): Promise<AiLegalInsight> {
    const { data, error } = await this.supabase
      .from('ai_legal_insights')
      .update(patch as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update AI legal insight status', error, {
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
   * Single point of conversion from a raw ai_legal_insights row
   * (result: generic Postgrest Json) to the validated AiLegalInsight
   * domain type (result: AiLegalInsightResult | null). Throws
   * DatabaseError, not a raw ZodError, on mismatch — same classification
   * as every prior module's parseRow: a persisted result failing schema
   * validation is a data-integrity problem, not a normal
   * not-found/bad-request case. Single-column validation, matching
   * AIRecommendationRepository#parseRow rather than
   * LegalHealthScoreRepository#parseRow's two-column validation — this
   * table has only one jsonb column to validate.
   */
  private parseRow(row: AiLegalInsightRow): AiLegalInsight {
    if (row.result === null) {
      return { ...row, result: null };
    }

    const parsed = aiLegalInsightResultSchema.safeParse(row.result);

    if (!parsed.success) {
      throw new DatabaseError(
        'ai_legal_insights row contains a result that does not match the expected schema',
        parsed.error,
        { table: this.tableName, id: row.id },
      );
    }

    return { ...row, result: parsed.data };
  }
}

export type { CreateAiLegalInsightInput } from '@/modules/ai-legal-insight/ai-legal-insight.entity';