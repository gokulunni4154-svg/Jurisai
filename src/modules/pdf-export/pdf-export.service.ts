// src/modules/pdf-export/pdf-export.service.ts
// File 166 — JurisAI PDF Export module
// (renumbered from the originally-planned File 165, following the new
// pdf-export.template.tsx split — see that file's header for why)
// AMENDMENT (File 171) — adds getDownloadUrl(), mirroring
// DocumentService's getDownloadUrl() (Amendment #13) exactly.

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { renderToBuffer } from '@react-pdf/renderer';

import type { AuthUser } from '@/core/auth/types';
import { NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import type { Database } from '@/core/supabase/database.types';
import type { DocumentService } from '@/modules/documents/document.service';
import type { DocumentAnalysisService } from '@/modules/document-analysis/document-analysis.service';
import type { ClauseClassificationService } from '@/modules/clause-classification/clause-classification.service';
import type { LegalHealthScoreService } from '@/modules/legal-health-score/legal-health-score.service';

import { buildAnalysisReportDocument } from './pdf-export.template';
import type { PdfExportRepository } from './pdf-export.repository';
import type { PdfExport } from './pdf-export.entity';

/**
 * Private bucket for generated exports (File 162's migration). Kept as a
 * named constant here rather than re-derived anywhere else — mirrors
 * document-upload.ts's identical BUCKET constant for
 * legal-vault-documents.
 */
const BUCKET = 'legal-vault-exports';

/**
 * Single user-safe failure message for this module — see class-level
 * KEY DECISION on why this deviates from every AI-pipeline service's
 * USER_SAFE_FAILURE_MESSAGES-per-AIProviderError-code convention: this
 * module makes no AI provider call, so there is no AIProviderError to
 * branch on. Every real failure mode here (PDF rendering, Storage
 * upload) is treated as equally "unexpected" from the user's
 * perspective.
 */
const GENERIC_FAILURE_MESSAGE =
  'PDF export failed due to an unexpected error. Please try again.';

/**
 * Service layer for the PDF Export module (File 163's entity, File 162's
 * table/bucket, File 164's repository, File 165's JSX template).
 *
 * KEY DECISION — depends on SIX collaborators: pdfExportRepository (this
 * module's own), a Storage-capable `supabase` client, analysisService,
 * documentService, classificationService, and legalHealthScoreService.
 * The first four follow the identical pattern every upstream service
 * uses (analysisService + documentService for the create-time ownership
 * check; the module's own repository for persistence). The Storage
 * client is NEW — no other service in this project touches Storage
 * directly, every prior write is a table row. Injected via the
 * constructor rather than calling createClient() (File 14/server.ts)
 * internally, decided by Claude under explicit user delegation (no real
 * precedent exists either way): every repository in this project already
 * receives its SupabaseClient<Database> via constructor injection rather
 * than constructing one itself, so this keeps "who calls createClient()"
 * in exactly one place — presumably the Factory — consistent with that
 * existing convention, rather than introducing a second pattern for one
 * service.
 *
 * KEY DECISION — exposes TWO getLatestCompletedXForAnalysis()
 * passthroughs (classification, legal health score), mirroring
 * LegalHealthScoreService's identical five-passthrough pattern: so the
 * Route layer only needs this module's own Factory-resolved service to
 * gather both inputs runPdfExport() needs, rather than separately
 * constructing ClauseClassificationService and LegalHealthScoreService
 * itself.
 *
 * KEY DECISION — createPdfExport() does NOT check whether Clause
 * Classification or Legal Health Score have actually completed yet for
 * this analysis. Identical division of responsibility to every upstream
 * service's create method: creating the row is cheap and reversible, so
 * the "is there anything usable to compose a PDF from yet" check belongs
 * at runPdfExport() time (or the Route layer), not here.
 *
 * SCOPE, CONFIRMED WITH THE USER: exactly Clause Classification + Legal
 * Health Score, nothing more — runPdfExport() takes exactly these two
 * upstream inputs, not five like Legal Health Score Engine's synthesis.
 *
 * FLAGGED ASSUMPTION, same footing as every downstream service in this
 * project: BaseService's own source was never independently re-verified
 * in this thread beyond the one paste shown at the start of this session
 * — its requireAuthentication()/requireOwnership() signatures are used
 * below exactly as every upstream service already uses them.
 *
 * AMENDMENT (File 171) — adds getDownloadUrl(). See that method's own
 * doc comment below for its reasoning; nothing about the class-level
 * decisions above needed to change to accommodate it — it slots in as a
 * seventh public method alongside create/list/get/run/two passthroughs,
 * reusing getPdfExportById() and pdfExportRepository directly rather
 * than adding an eighth constructor dependency.
 */
export class PdfExportService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly pdfExportRepository: PdfExportRepository,
    private readonly supabase: SupabaseClient<Database>,
    private readonly analysisService: DocumentAnalysisService,
    private readonly documentService: DocumentService,
    private readonly classificationService: ClauseClassificationService,
    private readonly legalHealthScoreService: LegalHealthScoreService,
  ) {
    super(currentUser);
  }

  /**
   * Validates the target analysis (via analysisService.getAnalysisById —
   * document visibility + analysis-belongs-to-document check), requires
   * ownership of the parent document (fetched directly via
   * documentService, since analysisService does not expose it), then
   * creates a 'pending' pdf_exports row and returns it immediately. Does
   * NOT render a PDF — see class-level note on the create/run split,
   * identical to every upstream module.
   *
   * user_id is supplied explicitly here from the AuthUser returned by
   * requireOwnership() — unlike CreateClauseClassificationInput/
   * CreateLegalHealthScoreInput, CreatePdfExportInput requires it (File
   * 163's entity: pdf_exports.user_id is a real not-null denormalized
   * column with no default). This is the one real shape difference from
   * every upstream module's createX() method.
   */
  async createPdfExport(rawParams: unknown, analysisId: string): Promise<PdfExport> {
    this.requireAuthentication();

    // Fetched directly for its owner_id — analysisService.getAnalysisById
    // below performs its own equivalent document fetch internally, but
    // does not return the document itself. Same deliberate duplication
    // as every upstream service's create method.
    const document = await this.documentService.getDocumentById(rawParams);

    // No admin override — mirrors every upstream create method: starting
    // an export run (even though it costs no AI-provider spend, unlike
    // every prior module) still gates on ownership, not just RLS
    // visibility, for consistency with the rest of this project's
    // write-path convention.
    const user = this.requireOwnership(document.owner_id);

    // Confirms the analysis exists, is visible to this caller, and
    // actually belongs to the document identified by rawParams — throws
    // NotFoundError otherwise.
    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    // KNOWN FLAGGED MISMATCH, same idiom as every upstream service:
    // CreatePdfExportInput ({ document_analysis_id, user_id }) is
    // narrower than the inherited create()'s Database-derived Insert
    // type. Cast follows BaseRepository's own established `as never`
    // pattern for this exact situation.
    const pdfExport = await this.pdfExportRepository.create({
      document_analysis_id: analysis.id,
      user_id: user.id,
    } as never);

    return pdfExport as PdfExport;
  }

  /**
   * Lists all export runs for a given analysis, most recent first.
   * Mirrors every upstream module's listXForAnalysis() reasoning
   * exactly: re-validates the analysis first rather than trusting
   * pdf_exports' own RLS alone, so an invisible or cross-document
   * analysisId surfaces as an explicit NotFoundError, not a silently
   * empty list.
   *
   * No requireOwnership() here, unlike createPdfExport() — reads follow
   * the same RLS-only-for-reads convention as every upstream module.
   */
  async listPdfExportsForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<PdfExport[]> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    return this.pdfExportRepository.findByDocumentAnalysisId(analysis.id);
  }

  /**
   * Fetches a single export run, scoped to an analysis the caller can
   * see. Mirrors every upstream module's getXById() pattern exactly:
   * re-validate the parent (the analysis) first, then verify the
   * fetched export's document_analysis_id actually matches it — a real
   * but differently-owned-or-scoped pdfExportId must 404, not leak
   * cross-analysis data.
   *
   * No requireOwnership() — same reasoning as every upstream module's
   * equivalent: this is a read.
   */
  async getPdfExportById(
    rawParams: unknown,
    analysisId: string,
    pdfExportId: string,
  ): Promise<PdfExport> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const pdfExport = await this.pdfExportRepository.findByIdOrThrow(pdfExportId);

    if (pdfExport.document_analysis_id !== analysis.id) {
      // Deliberately identical in shape to "export doesn't exist" — same
      // reasoning as every upstream module's equivalent check: do not
      // let a caller distinguish "wrong analysis" from "no such export
      // at all" for a pair they don't have access to.
      throw new NotFoundError('pdf_exports', pdfExportId);
    }

    return pdfExport;
  }

  /**
   * Returns the most recent 'completed' export for a given analysis, or
   * null if none exists yet. This is the read File 162's migration
   * comment describes as making a completed export "re-downloadable
   * without regenerating" — the Route layer is expected to call this
   * before deciding whether to trigger a new runPdfExport() or just
   * serve the existing storage_path.
   *
   * Filters to status = 'completed' at this layer rather than delegating
   * to pdfExportRepository.findLatestByDocumentAnalysisId() directly
   * (which returns the latest row regardless of status) — same
   * reasoning as every upstream module's identical getLatestCompletedX:
   * a 'pending', 'processing', or 'failed' latest row must not silently
   * masquerade as a usable download.
   */
  async getLatestCompletedPdfExportForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<PdfExport | null> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const latest = await this.pdfExportRepository.findLatestByDocumentAnalysisId(analysis.id);

    return latest && latest.status === 'completed' ? latest : null;
  }

  /**
   * Passthrough to ClauseClassificationService's own latest-completed
   * read. One of the two upstream reads the Route layer is expected to
   * call before runPdfExport().
   */
  async getLatestCompletedClassificationForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<Awaited<
    ReturnType<ClauseClassificationService['getLatestCompletedClassificationForAnalysis']>
  >> {
    return this.classificationService.getLatestCompletedClassificationForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /**
   * Passthrough to LegalHealthScoreService's own latest-completed read.
   * The second of the two upstream reads the Route layer is expected to
   * call before runPdfExport().
   */
  async getLatestCompletedLegalHealthScoreForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<Awaited<
    ReturnType<LegalHealthScoreService['getLatestCompletedLegalHealthScoreForAnalysis']>
  >> {
    return this.legalHealthScoreService.getLatestCompletedLegalHealthScoreForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /**
   * Runs the actual export for an already-created 'pending' row: marks
   * it 'processing', renders the PDF via buildAnalysisReportDocument()
   * (File 165) + @react-pdf/renderer's renderToBuffer(), uploads the
   * resulting buffer to the legal-vault-exports bucket, then marks
   * 'completed' (with the real storage_path) or 'failed' (with a
   * user-safe message).
   *
   * Takes the two upstream inputs explicitly — classifiedClauses and
   * legalHealthScoreResult — mirroring every synthesis module's "stay
   * ignorant of how inputs were fetched" discipline: the Route layer
   * decides what "latest completed X" means operationally for both
   * reads, this service just composes over whatever it's handed.
   *
   * NO AIProviderError branching, unlike every upstream module's
   * equivalent — see class-level note and GENERIC_FAILURE_MESSAGE's own
   * comment: this module makes no AI provider call, so there's no
   * provider-specific error code to distinguish.
   *
   * Storage path convention: "{userId}/{pdfExportId}/analysis-report.pdf"
   * — mirrors document-upload.ts's "{owner_id}/{document_id}/{filename}"
   * structure (first segment must be the real auth uid, per File 162's
   * `storage.foldername(name)[1] = auth.uid()::text` policy). Written
   * via the injected `supabase` client, which per this class's own
   * constructor doc must be the RLS-respecting server.ts client acting
   * as the requesting user — never admin.ts — matching File 162's
   * migration comment exactly.
   *
   * Upload-failure handling mirrors document-upload.ts's own plain
   * `throw new Error(...)` pattern for a Storage error, rather than a
   * dedicated AppError subclass — no StorageError (or equivalent) class
   * was ever pasted into this project's app-error.ts in this thread, so
   * inventing one here would be exactly the kind of unverified-shape
   * guess this project's discipline exists to prevent.
   *
   * Never throws for a render or upload failure — same reasoning as
   * every upstream service's runX(): a caller invoking this without
   * awaiting it may have no way to receive a thrown error.
   */
  async runPdfExport(
    pdfExportId: string,
    userId: string,
    classifiedClauses: Parameters<typeof buildAnalysisReportDocument>[0],
    legalHealthScoreResult: Parameters<typeof buildAnalysisReportDocument>[1],
  ): Promise<PdfExport> {
    await this.pdfExportRepository.markProcessing(pdfExportId);

    try {
      const document = buildAnalysisReportDocument(classifiedClauses, legalHealthScoreResult);
      const buffer = await renderToBuffer(document);

      const storagePath = `${userId}/${pdfExportId}/analysis-report.pdf`;

      const { error: uploadError } = await this.supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });

      if (uploadError) {
        throw new Error(`PDF upload failed: ${uploadError.message}`);
      }

      return await this.pdfExportRepository.markCompleted(pdfExportId, storagePath);
    } catch (error) {
      // Best-effort record the row as failed so it doesn't sit in
      // 'processing' forever, then rethrow — identical structure to
      // every upstream service's secondary catch, same reasoning: a
      // failure while persisting the failure state must not mask the
      // original error.
      await this.pdfExportRepository
        .markFailed(pdfExportId, GENERIC_FAILURE_MESSAGE)
        .catch(() => {
          /* see comment above — original error takes priority */
        });

      throw error;
    }
  }

  /**
   * AMENDMENT (File 171) — new. Generates a short-lived signed download
   * URL for a completed export's PDF. Mirrors DocumentService's
   * getDownloadUrl() (Amendment #13) exactly, one layer over from
   * Documents rather than a fresh design: deliberately reuses
   * getPdfExportById()'s existing fetch-and-check sequence (analysis
   * visibility + document_analysis_id-match, both already RLS-scoped)
   * rather than querying the repository directly — same reasoning
   * DocumentService.getDownloadUrl() itself documents for not delegating
   * to getDocumentById() internally: duplicating a second, independent
   * implementation of "is this row visible to the caller" would risk
   * drifting from getPdfExportById()'s own definition of that same
   * check.
   *
   * Throws NotFoundError — not a distinct "not ready yet" error — for a
   * pending/processing/failed row or one with no storage_path, same
   * shape as DocumentService.getDownloadUrl()'s soft-delete check: from
   * the caller's point of view, a not-yet-downloadable export genuinely
   * isn't there yet.
   *
   * No requireOwnership() call — same reasoning as every read method on
   * this service: pdf_exports' RLS (File 162) already scopes reads to
   * user_id = auth.uid(), so a non-owner's pdfExportId never resolves in
   * the first place (findByIdOrThrow, called inside getPdfExportById(),
   * throws NotFoundError before this method's own status check is ever
   * reached).
   *
   * The repository's createSignedDownloadUrl() (File 170) is
   * intentionally authorization-blind — it will happily sign a URL for
   * any storage path it's given. This method is what keeps that safe:
   * it only ever passes a storage_path that came from a row this same
   * request already proved is both visible (survived getPdfExportById(),
   * which is RLS-scoped) and 'completed'.
   */
  async getDownloadUrl(
    rawParams: unknown,
    analysisId: string,
    pdfExportId: string,
  ): Promise<string> {
    const pdfExport = await this.getPdfExportById(rawParams, analysisId, pdfExportId);

    if (pdfExport.status !== 'completed' || !pdfExport.storage_path) {
      throw new NotFoundError('pdf_exports', pdfExportId);
    }

    return this.pdfExportRepository.createSignedDownloadUrl(pdfExport.storage_path);
  }
}

export type { PdfExport } from './pdf-export.entity';