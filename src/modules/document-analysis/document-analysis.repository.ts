// src/modules/document-analysis/document-analysis.repository.ts
// File 64 — JurisAI Document Analysis module
//
// AMENDMENT (stabilization pass): closes flagged assumption #2 from this
// file's original header comment. findById/findByIdOrThrow are now
// explicitly overridden (previously inherited unchanged from
// BaseRepository, silently returning the raw Row type with
// result: Json instead of the validated DocumentAnalysisResult shape).
// A shared parseRow() helper now validates `result` against
// documentAnalysisResultSchema at every read path in this repository,
// replacing the three separate `as DocumentAnalysis` casts that
// previously trusted the DB's jsonb column without verifying it.
//
// findById/findByIdOrThrow are reimplemented here rather than calling
// super.findById()/super.findByIdOrThrow() — deliberately. TypeScript
// resolves `this.findById` polymorphically at runtime even inside the
// base class's own methods; if this subclass only overrode findById,
// the inherited findByIdOrThrow would silently call the override at
// runtime while still being *declared* as returning the base Row type,
// producing a real type/runtime mismatch for external callers. Fully
// reimplementing both here (same query logic as BaseRepository,
// duplicated intentionally) avoids that footgun entirely — same
// "flagged duplication over silent-drift risk" tradeoff this project
// already accepts elsewhere (see DOCUMENTS_BUCKET in
// document.repository.ts).
//
// TWO FLAGGED ASSUMPTIONS, not silently folded in — see this file's
// chat message for full explanation:
//
//  1. `extends BaseRepository<'document_analyses'>` only compiles if
//     database.types.ts (File 11) has been regenerated since File 63's
//     migration to include the `document_analyses` table. Not confirmed
//     this session — assumed true because this file cannot compile
//     against the real base class otherwise.
//
//  2. RESOLVED (this amendment) — see comment block above.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';
import { documentAnalysisResultSchema, type DocumentAnalysisResult } from '@/modules/document-analysis/analysis.schemas';
import type {
  CreateDocumentAnalysisInput,
  DocumentAnalysis,
} from '@/modules/document-analysis/document-analysis.entity';

type DocumentAnalysisRow = Database['public']['Tables']['document_analyses']['Row'];

/**
 * Repository for the `document_analyses` table (File 63's migration).
 *
 * Extends BaseRepository<'document_analyses'> and inherits create() as-is
 * (create() takes CreateDocumentAnalysisInput conceptually — just
 * { document_id } — since status/result/etc. are either DB-defaulted or
 * set later via the transition methods below; whether the inherited
 * create()'s Database-derived Insert type lines up with that narrower
 * shape without a cast is unverified — flag for File 65 to surface at
 * actual call time, not worth blocking on here).
 *
 * findById/findByIdOrThrow ARE overridden — see amendment note above.
 *
 * findMany/count are NOT overridden — unlike Documents, nothing in
 * document-analysis.entity.ts suggests soft-delete or any other filter
 * default beyond plain pagination, so the base class's behavior is
 * assumed correct as-is.
 *
 * delete() is NOT overridden — same reasoning; no soft-delete concept
 * appears in the real entity type.
 *
 * RLS is expected to scope reads via a join to `documents` (per
 * PROJECT_PROGRESS.md's description of File 63) exactly like Legal
 * Vault — so, consistent with DocumentRepository, this repository adds
 * no explicit ownership filter of its own; the injected Supabase client
 * determines visibility.
 */
export class DocumentAnalysisRepository extends BaseRepository<'document_analyses'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'document_analyses');
  }

  /**
   * AMENDMENT: overrides BaseRepository#findById. Same query as the
   * base class implementation — deliberately duplicated, not calling
   * super, per this file's amendment note above — but routes the row
   * through parseRow() so `result` is validated against
   * documentAnalysisResultSchema instead of trusted as an opaque Json
   * blob.
   */
  override async findById(id: string): Promise<DocumentAnalysis | null> {
    const { data, error } = await this.supabase
      .from('document_analyses')
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
   * DocumentAnalysis type flows through consistently.
   */
  override async findByIdOrThrow(id: string): Promise<DocumentAnalysis> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return row;
  }

  /**
   * Lists all analysis runs for a given document, most recent first.
   * Needed by GET /api/documents/[id]/analyses (File 67). Ordering by
   * created_at desc is a reasonable default for "show history of runs
   * for this document" — not specified anywhere, flagged as a choice.
   */
  async findByDocumentId(documentId: string): Promise<DocumentAnalysis[]> {
    const { data, error } = await this.supabase
      .from('document_analyses')
      .select('*')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError('Failed to list analyses for document', error, {
        table: this.tableName,
        documentId,
      });
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * NEW — added for the Observability module (Phase 3). Third of the
   * four sequential hops in Observability's firm-scoped query path
   * (profiles -> owner ids -> documents -> document_analyses -> each
   * module repo). Given the document ids resolved by
   * DocumentRepository#findManyForOwnerIds, returns every analysis run
   * across all of them in one call.
   *
   * Unlike DocumentRepository#findManyForOwnerIds, this method is NOT
   * flagged as admin-client-only in the same sense — the ownership
   * boundary was already crossed one hop earlier (at the `documents`
   * step). This method only takes a list of document ids the caller has
   * already legitimately resolved; it doesn't itself decide who's
   * allowed to see them. Still expected to run under the admin client in
   * practice (Observability's whole query chain does, per the four-hop
   * design), but that's inherited from the caller's context, not
   * re-justified independently here.
   *
   * Routes every row through parseRow() — same as findById/
   * findByDocumentId above — so `result` is validated against
   * documentAnalysisResultSchema for every row returned, not trusted as
   * an opaque Json blob. No ordering imposed (Observability's own
   * service/aggregation layer is expected to sort/group these across
   * documents as needed, not this repository).
   *
   * Returns an empty array (not an error) when `documentIds` is empty,
   * matching Postgrest's own `.in()` semantics — same reasoning as
   * findManyForOwnerIds: a firm with zero documents should read as
   * "zero analyses", not throw.
   */
  async findManyForDocumentIds(documentIds: string[]): Promise<DocumentAnalysis[]> {
    if (documentIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('document_analyses')
      .select('*')
      .in('document_id', documentIds);

    if (error) {
      throw new DatabaseError('Failed to find document analyses for document ids', error, {
        table: this.tableName,
        documentIds,
      });
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * Transitions an analysis run from 'pending' to 'processing'. Called
   * by File 65 immediately before the AI call starts, so a caller
   * polling GET .../analyses/[analysisId] can distinguish "queued" from
   * "actually running" rather than the row sitting at 'pending' for the
   * AI call's entire duration.
   */
  async markProcessing(id: string): Promise<DocumentAnalysis> {
    return this.applyTransition(id, { status: 'processing' });
  }

  /**
   * Transitions to 'completed', recording the result, which provider
   * actually produced it (relevant given File 61's fallback — the
   * configured default isn't necessarily who answered), and
   * completed_at. All three are required together deliberately: a
   * 'completed' row with a null result would be a state the rest of the
   * system (Legal Health Score, Smart Timeline — both future consumers
   * named in ARCHITECTURE.md) has no valid way to handle.
   */
  async markCompleted(
    id: string,
    result: DocumentAnalysisResult,
    providerUsed: AIProviderName,
  ): Promise<DocumentAnalysis> {
    return this.applyTransition(id, {
      status: 'completed',
      result,
      provider_used: providerUsed,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Transitions to 'failed', recording why. errorMessage is intended to
   * be a message safe to eventually surface to the end user (File 65's
   * job to ensure — e.g. not a raw provider stack trace) — this method
   * just persists whatever string it's given, it doesn't sanitize.
   */
  async markFailed(id: string, errorMessage: string): Promise<DocumentAnalysis> {
    return this.applyTransition(id, {
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Shared implementation for the three transition methods above.
   * Private — not exposed directly, so every status change goes through
   * one of the three named, self-documenting methods instead of an
   * arbitrary partial patch.
   *
   * Same `as never` rationale as BaseRepository#create/#update: the
   * table name is fixed to a literal here ('document_analyses'), so
   * this is actually less justified than the base class's generic-T
   * case — Postgrest-js *could* narrow this correctly. Cast kept for
   * consistency with the rest of the codebase's established pattern
   * rather than fighting it in one isolated spot; worth revisiting if
   * it turns out to actually type-check without the cast.
   */
  private async applyTransition(
    id: string,
    patch: Partial<Omit<DocumentAnalysis, 'id' | 'document_id' | 'created_at'>>,
  ): Promise<DocumentAnalysis> {
    const { data, error } = await this.supabase
      .from('document_analyses')
      .update(patch as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update document analysis status', error, {
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
   * AMENDMENT — new. Single point of conversion from a raw
   * `document_analyses` row (where `result` is the generic Postgrest
   * `Json` type) to the validated `DocumentAnalysis` domain type (where
   * `result` is the specific `DocumentAnalysisResult` shape, or `null`
   * for rows that haven't completed yet).
   *
   * Throws DatabaseError — not a raw ZodError — if a non-null `result`
   * fails to match documentAnalysisResultSchema. That scenario means
   * the AI provider's response was persisted without ever being
   * validated against the schema at write time (a real bug elsewhere,
   * e.g. if markCompleted's `result` parameter type were ever
   * bypassed via `as never`), or someone/something wrote to this
   * column outside the application. Either way it's a data-integrity
   * problem, not a normal "not found" or "bad request" — DatabaseError
   * is the correct classification, same as every other persistence-
   * layer failure in this file.
   */
  private parseRow(row: DocumentAnalysisRow): DocumentAnalysis {
    if (row.result === null) {
      return { ...row, result: null };
    }

    const parsed = documentAnalysisResultSchema.safeParse(row.result);

    if (!parsed.success) {
      throw new DatabaseError(
        'document_analyses row contains a result that does not match the expected schema',
        parsed.error,
        { table: this.tableName, id: row.id },
      );
    }

    return { ...row, result: parsed.data };
  }
}

// Re-exported so File 65 can construct a valid create() input without
// importing document-analysis.entity.ts directly, mirroring how
// DocumentFindManyOptions is exported alongside DocumentRepository.
export type { CreateDocumentAnalysisInput };