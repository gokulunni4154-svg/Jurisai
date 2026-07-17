// src/modules/ocr/ocr-extraction.repository.ts
// File 74 — JurisAI OCR module
//
// AMENDMENT (stabilization pass): closes the same category of gap File
// 64/86 closed for document_analyses. create()/findById/findByIdOrThrow
// are now explicitly overridden (previously inherited unchanged from
// BaseRepository, silently returning the raw Row type with
// status: string and result: Json instead of the validated
// OCRExtractionStatus/OCRExtractionResultData shapes). A shared
// parseRow() helper now validates both fields at every read/write path
// in this repository.
//
// findById/findByIdOrThrow are reimplemented here rather than calling
// super.findById()/super.findByIdOrThrow() — same reasoning as File 64's
// identical amendment: `this.findById` resolves polymorphically at
// runtime even inside the base class's own methods, so only overriding
// findById would leave findByIdOrThrow silently calling the override at
// runtime while still being *declared* as returning the base Row type.
// create() is reimplemented for the same reason — it's the actual call
// site OCRService.createExtraction() uses directly.
//
// FLAGGED ASSUMPTIONS, not silently folded in — see this file's chat
// message for full explanation:
//
//  1. `extends BaseRepository<'ocr_extractions'>` only compiles if
//     database.types.ts (File 11) has been regenerated since the
//     migration accompanying File 73 to include the `ocr_extractions`
//     table. Not confirmed this session — assumed true because this
//     file cannot compile against the real base class otherwise, same
//     as File 64's identical assumption for document_analyses.
//
//  2. OCRExtraction (File 73) has NO completed_at column, unlike
//     DocumentAnalysis. markCompleted/markFailed below therefore do NOT
//     set one. UPDATED — Amendment #22: this file originally assumed
//     updated_at was DB-managed via a trigger; PROJECT_PROGRESS.md's
//     real, earlier-recorded decision for File 73's migration says
//     otherwise (no trigger), so applyTransition now sets updated_at
//     explicitly on every transition. If a future migration adds
//     completed_at, the patch type in applyTransition will need
//     widening then — not invented preemptively here.
//
//  3. findByDocumentId returns an array (mirroring File 64's method of
//     the same name), on the assumption that the real schema does not
//     enforce exactly one extraction row per document. This has not
//     been confirmed against the real migration — flagged for the OCR
//     Service (File 75) to reconsider if that invariant turns out to be
//     real (in which case a findLatestByDocumentId could be added on
//     top of this rather than changing this method's contract).
//
//  4. RESOLVED (this amendment) — see comment block above re: status/
//     result validation.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';
import {
  ocrExtractionResultSchema,
  ocrExtractionStatusSchema,
  type OCRExtractionResultData,
} from '@/modules/ocr/ocr.schemas';
import type {
  CreateOCRExtractionInput,
  OCRExtraction,
} from '@/modules/ocr/ocr-extraction.entity';

type OCRExtractionRow = Database['public']['Tables']['ocr_extractions']['Row'];

/**
 * Repository for the `ocr_extractions` table (migration accompanying
 * File 73).
 *
 * Extends BaseRepository<'ocr_extractions'>. create(), findById(), and
 * findByIdOrThrow() ARE now overridden — see amendment note above.
 * create() still conceptually takes CreateOCRExtractionInput — just
 * { document_id } — since status/result/etc. are either DB-defaulted
 * ('pending') or set later via the transition methods below; same
 * unverified-but-flagged gap File 64 carries for its own create() call
 * site, left for the OCR Service (File 75) to surface at actual use.
 *
 * findMany/count/delete are NOT overridden — nothing in
 * ocr-extraction.entity.ts suggests soft-delete or a non-default
 * pagination filter, so the base class's behavior is assumed correct
 * as-is, same reasoning File 64 gives for document_analyses.
 *
 * RLS is expected to scope reads via a join to `documents`, exactly
 * like Legal Vault and document_analyses — this repository adds no
 * explicit ownership filter of its own; the injected Supabase client
 * determines visibility.
 */
export class OCRExtractionRepository extends BaseRepository<'ocr_extractions'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'ocr_extractions');
  }

  /**
   * AMENDMENT: overrides BaseRepository#create. Same `as never` cast
   * rationale as the base class's own create() (table name fixed to a
   * literal, Postgrest-js overload resolution limitation), but routes
   * the returned row through parseRow() so callers (OCRService.
   * createExtraction()) get a validated OCRExtraction, not a raw row
   * with status: string.
   */
  override async create(input: CreateOCRExtractionInput): Promise<OCRExtraction> {
    const { data, error } = await this.supabase
      .from('ocr_extractions')
      .insert(input as never)
      .select('*')
      .single();

    if (error) {
      throw new DatabaseError(`Failed to create ${String(this.tableName)}`, error, {
        table: this.tableName,
      });
    }

    return this.parseRow(data);
  }

  /**
   * AMENDMENT: overrides BaseRepository#findById. Same query as the
   * base class implementation, routed through parseRow().
   */
  override async findById(id: string): Promise<OCRExtraction | null> {
    const { data, error } = await this.supabase
      .from('ocr_extractions')
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
   * OCRExtraction type flows through consistently.
   */
  override async findByIdOrThrow(id: string): Promise<OCRExtraction> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return row;
  }

  /**
   * Lists all extraction runs for a given document, most recent first.
   * Needed by the future OCR API routes (File 76) so a caller can find
   * the current/latest extraction for a document without knowing its
   * row id ahead of time. Ordering by created_at desc mirrors File 64's
   * identical choice for the same reason: "show history of runs for
   * this document" is the natural default absent any spec saying
   * otherwise.
   */
  async findByDocumentId(documentId: string): Promise<OCRExtraction[]> {
    const { data, error } = await this.supabase
      .from('ocr_extractions')
      .select('*')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError('Failed to list OCR extractions for document', error, {
        table: this.tableName,
        documentId,
      });
    }

    return (data ?? []).map((row) => this.parseRow(row));
  }

  /**
   * Transitions an extraction from 'pending' to 'processing'. Called by
   * the OCR Service (File 75) immediately before GoogleVisionOCRProvider
   * (File 71) is invoked, so a caller polling the extraction's status
   * can distinguish "queued" from "actually running" — same rationale
   * File 64's markProcessing documents for document_analyses.
   */
  async markProcessing(id: string): Promise<OCRExtraction> {
    return this.applyTransition(id, { status: 'processing' });
  }

  /**
   * Transitions to 'completed', recording the result and which provider
   * produced it. `provider` is a plain string, not a fixed union —
   * mirroring ocrProviderNameSchema's deliberate looseness (File 72),
   * since OCRExtractionResult.provider (File 70) is itself a plain
   * string for the same forward-compatibility reason.
   *
   * Both fields are required together deliberately, same as File 64's
   * markCompleted: a 'completed' row with a null result would be a
   * state no downstream consumer (Legal Health Score, AI Chat — both
   * future consumers per ARCHITECTURE.md) has a valid way to handle.
   *
   * No completed_at is set here — see this file's header, assumption
   * #2.
   */
  async markCompleted(
    id: string,
    result: OCRExtractionResultData,
    provider: string,
  ): Promise<OCRExtraction> {
    return this.applyTransition(id, {
      status: 'completed',
      result,
      provider,
    });
  }

  /**
   * Transitions to 'failed', recording why. `errorMessage` is expected
   * to already be a user-safe string by the time it reaches here — the
   * OCR Service (File 75) owns translating an OCRProviderError's
   * category into that message (per ocr.schemas.ts's header comment on
   * the 'failed' status), this method just persists whatever string
   * it's given without sanitizing it further.
   */
  async markFailed(id: string, errorMessage: string): Promise<OCRExtraction> {
    return this.applyTransition(id, {
      status: 'failed',
      error_message: errorMessage,
    });
  }

  /**
   * Shared implementation for the three transition methods above.
   * Private — not exposed directly, so every status change goes
   * through one of the three named, self-documenting methods instead
   * of an arbitrary partial patch, same convention File 64 establishes.
   *
   * Same `as never` rationale as BaseRepository#create/#update and
   * File 64's applyTransition: the table name is fixed to a literal
   * here ('ocr_extractions'), so Postgrest-js could plausibly narrow
   * this correctly without the cast — kept for consistency with the
   * rest of the codebase's established pattern rather than fighting it
   * in one isolated spot.
   */
  private async applyTransition(
    id: string,
    patch: Partial<Omit<OCRExtraction, 'id' | 'document_id' | 'created_at'>>,
  ): Promise<OCRExtraction> {
    // Amendment #22: ocr_extractions (File 73's migration) has no DB
    // trigger maintaining updated_at, unlike whatever document_analyses
    // relies on — this file's original header (assumption #2) guessed
    // otherwise; PROJECT_PROGRESS.md's real, earlier-recorded decision
    // overrides that guess. Set explicitly on every transition, here in
    // one place rather than in each of the three call sites above, so a
    // future fourth transition method can't accidentally omit it.
    const patchWithTimestamp = {
      ...patch,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from('ocr_extractions')
      .update(patchWithTimestamp as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update OCR extraction status', error, {
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
   * `ocr_extractions` row (where `status` is the generic Postgrest
   * `string` column type and `result` is generic `Json`) to the
   * validated `OCRExtraction` domain type.
   *
   * Throws DatabaseError — not a raw ZodError — if `status` doesn't
   * match one of the four known lifecycle values, or if a non-null
   * `result` fails to match ocrExtractionResultSchema. Both scenarios
   * indicate a real data-integrity problem (a write bypassed this
   * repository's typed transition methods, or something wrote to this
   * table outside the application) rather than a normal "not found" or
   * "bad request" — same classification File 86's identical helper
   * uses for document_analyses.
   */
  private parseRow(row: OCRExtractionRow): OCRExtraction {
    const statusResult = ocrExtractionStatusSchema.safeParse(row.status);

    if (!statusResult.success) {
      throw new DatabaseError(
        'ocr_extractions row contains a status value outside the known lifecycle',
        statusResult.error,
        { table: this.tableName, id: row.id },
      );
    }

    if (row.result === null) {
      return { ...row, status: statusResult.data, result: null };
    }

    const resultParse = ocrExtractionResultSchema.safeParse(row.result);

    if (!resultParse.success) {
      throw new DatabaseError(
        'ocr_extractions row contains a result that does not match the expected schema',
        resultParse.error,
        { table: this.tableName, id: row.id },
      );
    }

    return { ...row, status: statusResult.data, result: resultParse.data };
  }
}

// Re-exported so File 75 can construct a valid create() input without
// importing ocr-extraction.entity.ts directly, mirroring how
// CreateDocumentAnalysisInput is re-exported alongside
// DocumentAnalysisRepository (File 64).
export type { CreateOCRExtractionInput };