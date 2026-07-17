// src/modules/pdf-export/pdf-export.repository.ts
// File 164 — JurisAI PDF Export module
//
// Built directly against real, pasted source: File 64
// (document-analysis.repository.ts, for the transition-method pattern),
// File 163 (pdf-export.entity.ts), and File 162
// (20260724000000_pdf_exports.sql). No field, column, or method here is
// inferred from a description — every name below is copied from one of
// those three files.
//
// DELIBERATE DEVIATION FROM FILE 64's SHAPE, flagged not silent:
// File 64 overrides findById/findByIdOrThrow ONLY because
// document_analyses.result is an opaque jsonb column that needs
// validating against documentAnalysisResultSchema on every read. File
// 163's own header is explicit that pdf_exports has no result field and
// no companion schemas.ts — every column here is a plain scalar that
// maps 1:1 onto the PdfExport interface. File 64's own stated logic for
// NOT overriding findMany/count/delete ("nothing... suggests a filter
// default beyond plain pagination, so the base class's behavior is
// assumed correct as-is") applies here to findById/findByIdOrThrow too:
// there is no divergence from base behavior to close, so this class
// does not override them. Confirmed with the user directly before
// writing this rather than assumed.
//
// CARRIED-FORWARD ASSUMPTION (same one File 64 flags for itself):
// `extends BaseRepository<'pdf_exports'>` only compiles if
// database.types.ts (File 11) has been regenerated since File 162's
// migration to include the `pdf_exports` table. Not confirmed this
// session — assumed true because this file cannot compile against the
// real base class otherwise, same footing as File 64's identical flag
// for `document_analyses`.
//
// AMENDMENT 1 (confirmed with the user before building File 165):
// findByDocumentAnalysisId/findLatestByDocumentAnalysisId added below,
// closing the gap flagged in the original version of this file. Mirrors
// LegalHealthScoreRepository's (File 135) and ClauseClassificationRepository's
// (File 95) identically-named, identically-shaped methods exactly — same
// "plural by design" reasoning does NOT carry over, though: unlike those
// two tables, nothing in File 162's migration or File 163's entity
// suggests re-running a PDF export for the same document_analysis_id is
// a first-class, expected occurrence the way re-running an AI pipeline
// stage is. Both methods are still added, for symmetry with the rest of
// the project's repositories and because findLatestByDocumentAnalysisId
// is what File 165 needs for the "re-downloadable without regenerating"
// read — not because multiple real exports per analysis are expected in
// practice.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';
import type { CreatePdfExportInput, PdfExport } from '@/modules/pdf-export/pdf-export.entity';

type PdfExportRow = Database['public']['Tables']['pdf_exports']['Row'];

/**
 * Repository for the `pdf_exports` table (File 162's migration).
 *
 * Extends BaseRepository<'pdf_exports'> and inherits create() as-is —
 * same reasoning as DocumentAnalysisRepository's identical comment for
 * document_analyses: create() takes CreatePdfExportInput conceptually
 * ({ document_analysis_id, user_id }), since status/storage_path/
 * error_message/completed_at are either DB-defaulted (status, per File
 * 162's `default 'pending'`) or set later via the transition methods
 * below. Whether the inherited create()'s Database-derived Insert type
 * lines up with that narrower shape without a cast is unverified — same
 * flag File 64 raises for itself, deferred to File 165's actual call
 * site rather than blocked on here.
 *
 * findById/findByIdOrThrow are NOT overridden — see deviation note
 * above. Both are inherited directly from BaseRepository.
 *
 * findMany/count/delete are NOT overridden — File 162's migration has
 * no DELETE RLS policy at all ("nothing in this session's scope calls
 * for users to delete a generated export record"), and nothing in File
 * 163's entity suggests a filter default beyond plain pagination. Same
 * "assumed correct as-is" reasoning File 64 applies to these three
 * methods for document_analyses.
 *
 * RLS scopes reads/writes directly via pdf_exports.user_id = auth.uid()
 * (File 162) — no join required, unlike DocumentAnalysisRepository's
 * join-based RLS through `documents`. This repository adds no explicit
 * ownership filter of its own; the injected Supabase client (server.ts,
 * per File 162's own comment — never admin.ts) determines visibility.
 */
export class PdfExportRepository extends BaseRepository<'pdf_exports'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'pdf_exports');
  }

  /**
   * AMENDMENT 1: new. Returns every export run for a given analysis,
   * most recent first. Mirrors LegalHealthScoreRepository#findByDocumentAnalysisId
   * and ClauseClassificationRepository#findByDocumentAnalysisId exactly
   * in shape — see the amendment note above on why plurality is kept for
   * symmetry rather than an expected real-world occurrence.
   */
  async findByDocumentAnalysisId(documentAnalysisId: string): Promise<PdfExport[]> {
    const { data, error } = await this.supabase
      .from('pdf_exports')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError('Failed to list pdf_exports by document_analysis_id', error, {
        table: this.tableName,
        documentAnalysisId,
      });
    }

    return (data ?? []) as PdfExportRow[] as PdfExport[];
  }

  /**
   * AMENDMENT 1: new. Returns the most recent export run for a given
   * analysis, or null if none exists yet. This is the method File 165 is
   * expected to use for the "is there already a completed export to
   * re-download" read described in File 162's migration comment — mirrors
   * LegalHealthScoreRepository#findLatestByDocumentAnalysisId and
   * ClauseClassificationRepository#findLatestByDocumentAnalysisId exactly.
   */
  async findLatestByDocumentAnalysisId(documentAnalysisId: string): Promise<PdfExport | null> {
    const { data, error } = await this.supabase
      .from('pdf_exports')
      .select('*')
      .eq('document_analysis_id', documentAnalysisId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find latest pdf_export by document_analysis_id',
        error,
        { table: this.tableName, documentAnalysisId },
      );
    }

    return data ? (data as PdfExportRow as PdfExport) : null;
  }

  /**
   * Transitions an export run from 'pending' to 'processing'. Intended
   * to be called by File 165 immediately before PDF composition starts,
   * mirroring File 64's markProcessing — same "let a poller distinguish
   * queued from actually running" rationale.
   */
  async markProcessing(id: string): Promise<PdfExport> {
    return this.applyTransition(id, { status: 'processing' });
  }

  /**
   * Transitions to 'completed', recording the Storage object's path and
   * completed_at. Both required together deliberately, same reasoning
   * as File 64's markCompleted requiring result+provider_used+
   * completed_at together: a 'completed' row with a null storage_path
   * would be a state nothing downstream (the download route) has a
   * valid way to handle.
   */
  async markCompleted(id: string, storagePath: string): Promise<PdfExport> {
    return this.applyTransition(id, {
      status: 'completed',
      storage_path: storagePath,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Transitions to 'failed', recording why. Same contract as File 64's
   * markFailed: errorMessage is expected to already be user-safe (File
   * 165's job to ensure, per the USER_SAFE_FAILURE_MESSAGES convention
   * File 162's own column comment references) — this method just
   * persists whatever string it's given, it doesn't sanitize.
   */
  async markFailed(id: string, errorMessage: string): Promise<PdfExport> {
    return this.applyTransition(id, {
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Shared implementation for the three transition methods above.
   * Private — not exposed directly, same rationale as File 64's
   * identically-shaped applyTransition: every status change goes
   * through one of the three named, self-documenting methods instead of
   * an arbitrary partial patch.
   *
   * Same `as never` cast rationale File 64 documents for itself: the
   * table name is fixed to a literal here ('pdf_exports'), so this is
   * less justified than the base class's generic-T case — kept for
   * consistency with the established project pattern rather than
   * fighting it in one isolated spot.
   *
   * No parseRow() step here, unlike File 64's applyTransition — see
   * deviation note above. The row returned by Postgrest already matches
   * the PdfExport shape field-for-field (given the database.types.ts
   * assumption flagged above), so it's returned directly rather than
   * routed through a validator that would have nothing to validate.
   */
  private async applyTransition(
    id: string,
    patch: Partial<Omit<PdfExport, 'id' | 'document_analysis_id' | 'user_id' | 'created_at'>>,
  ): Promise<PdfExport> {
    const { data, error } = await this.supabase
      .from('pdf_exports')
      .update(patch as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update pdf export status', error, {
        table: this.tableName,
        id,
        patch,
      });
    }

    if (!data) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return data as PdfExportRow as PdfExport;
  }
}

// Re-exported so File 165 can construct a valid create() input without
// importing pdf-export.entity.ts directly, mirroring File 64's identical
// re-export of CreateDocumentAnalysisInput.
export type { CreatePdfExportInput };