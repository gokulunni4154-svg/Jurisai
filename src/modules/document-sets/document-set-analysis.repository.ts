// src/modules/document-sets/document-set-analysis.repository.ts
// Multi-document module — File number not yet assigned.
//
// Built directly against the real, pasted document-analysis.repository.ts
// — same structure deliberately duplicated, not abstracted into a shared
// base: findById/findByIdOrThrow overridden (not calling super, for the
// identical polymorphic-dispatch reason that file's own header explains),
// a shared parseRow() validating `result` against
// documentSetAnalysisResultSchema on every read path, and the same three
// named transition methods (markProcessing/markCompleted/markFailed) over
// one private applyTransition().
//
// RLS-ONLY, NO ADMIN CLIENT — matching document-set.repository.ts's own
// posture (and unlike document-analysis.repository.ts's Observability
// addendum, findManyForDocumentIds is not needed here — nothing in this
// module's confirmed scope requires cross-tenant reads). Every method
// below relies on document_set_analyses' own RLS (the EXISTS-join-to-
// document_sets policies from this table's migration) for visibility.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';
import {
  documentSetAnalysisResultSchema,
  type DocumentSetAnalysisResult,
} from '@/modules/document-sets/document-set-analysis.schemas';

type DocumentSetAnalysisRow = Database['public']['Tables']['document_set_analyses']['Row'];

/**
 * Domain type for a document_set_analyses row, with `result` narrowed
 * from the generic Postgrest `Json` to the validated
 * DocumentSetAnalysisResult shape (or `null` for rows that haven't
 * completed yet) — same relationship documentAnalysisResultSchema has to
 * DocumentAnalysis in the sibling module.
 */
export type DocumentSetAnalysis = Omit<DocumentSetAnalysisRow, 'result'> & {
  result: DocumentSetAnalysisResult | null;
};

export class DocumentSetAnalysisRepository extends BaseRepository<'document_set_analyses'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'document_set_analyses');
  }

  /**
   * Overrides BaseRepository#findById — same reasoning as
   * document-analysis.repository.ts's identical override: routes the row
   * through parseRow() so `result` is validated against
   * documentSetAnalysisResultSchema instead of trusted as an opaque Json
   * blob.
   */
  override async findById(id: string): Promise<DocumentSetAnalysis | null> {
    const { data, error } = await this.supabase
      .from('document_set_analyses')
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
   * Overrides BaseRepository#findByIdOrThrow — calls this class's own
   * findById() override, not super's, same reasoning as
   * document-analysis.repository.ts.
   */
  override async findByIdOrThrow(id: string): Promise<DocumentSetAnalysis> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return row;
  }

  /**
   * Lists all synthesis runs for a given document_set, most recent first
   * — the run-history read the future DocumentSetService needs (mirrors
   * DocumentAnalysisRepository#findByDocumentId exactly, one level up).
   */
  async findByDocumentSetId(documentSetId: string): Promise<DocumentSetAnalysis[]> {
    const { data, error } = await this.supabase
      .from('document_set_analyses')
      .select('*')
      .eq('document_set_id', documentSetId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError('Failed to list analyses for document set', error, {
        table: this.tableName,
        documentSetId,
      });
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * Returns the most recent COMPLETED synthesis run for a set, or null —
   * mirrors the getLatestCompletedXForAnalysis() passthrough shape every
   * upstream module in this project already exposes (e.g.
   * ai-legal-insight.service.ts's own six passthroughs), so the future
   * DocumentSetService can offer the same "latest completed" convenience
   * read without the Route layer having to filter findByDocumentSetId's
   * full history itself.
   */
  async findLatestCompletedByDocumentSetId(
    documentSetId: string,
  ): Promise<DocumentSetAnalysis | null> {
    const { data, error } = await this.supabase
      .from('document_set_analyses')
      .select('*')
      .eq('document_set_id', documentSetId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find latest completed analysis for document set', error, {
        table: this.tableName,
        documentSetId,
      });
    }

    return data ? this.parseRow(data) : null;
  }

  /**
   * Transitions a synthesis run from 'pending' to 'processing'. Same
   * timing/purpose as DocumentAnalysisRepository#markProcessing: called
   * immediately before the AI call starts, so a caller polling this run
   * can distinguish "queued" from "actually running".
   */
  async markProcessing(id: string): Promise<DocumentSetAnalysis> {
    return this.applyTransition(id, { status: 'processing' });
  }

  /**
   * Transitions to 'completed', recording the result, which provider
   * actually answered, and completed_at — all three required together,
   * same reasoning as DocumentAnalysisRepository#markCompleted: a
   * 'completed' row with a null result is a state nothing downstream can
   * handle.
   */
  async markCompleted(
    id: string,
    result: DocumentSetAnalysisResult,
    providerUsed: AIProviderName,
  ): Promise<DocumentSetAnalysis> {
    return this.applyTransition(id, {
      status: 'completed',
      result,
      provider_used: providerUsed,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Transitions to 'failed', recording why. Same contract as
   * DocumentAnalysisRepository#markFailed — errorMessage must already be
   * user-safe by the time it reaches this method; this method persists it
   * verbatim, it doesn't sanitize.
   */
  async markFailed(id: string, errorMessage: string): Promise<DocumentSetAnalysis> {
    return this.applyTransition(id, {
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Shared implementation for the three transition methods above — same
   * `as never` rationale as DocumentAnalysisRepository#applyTransition
   * (and BaseRepository#create/#update before it): kept for consistency
   * with this project's established pattern rather than fighting it in
   * one isolated spot.
   */
  private async applyTransition(
    id: string,
    patch: Partial<Omit<DocumentSetAnalysis, 'id' | 'document_set_id' | 'created_at'>>,
  ): Promise<DocumentSetAnalysis> {
    const { data, error } = await this.supabase
      .from('document_set_analyses')
      .update(patch as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update document set analysis status', error, {
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
   * Single point of conversion from a raw document_set_analyses row to
   * the validated DocumentSetAnalysis domain type — same role and same
   * failure classification as DocumentAnalysisRepository#parseRow: a
   * non-null `result` that fails schema validation is a data-integrity
   * problem (written outside the validated markCompleted() path, or
   * written outside the application entirely), so it throws
   * DatabaseError, not a bare ZodError.
   */
  private parseRow(row: DocumentSetAnalysisRow): DocumentSetAnalysis {
    if (row.result === null) {
      return { ...row, result: null };
    }

    const parsed = documentSetAnalysisResultSchema.safeParse(row.result);

    if (!parsed.success) {
      throw new DatabaseError(
        'document_set_analyses row contains a result that does not match the expected schema',
        parsed.error,
        { table: this.tableName, id: row.id },
      );
    }

    return { ...row, result: parsed.data };
  }
}