// src/modules/ocr/ocr.service.ts
// File 75 — JurisAI OCR module
//
// PROVENANCE NOTE: an earlier version of this file was built in a prior
// session, before OCRExtractionRepository (File 74), the OCR provider
// interface (File 70), the OCR schemas (File 72), and the OCR entity
// (File 73) had all been independently re-verified in that session's
// context. That earlier version does not exist as real source anywhere
// this conversation has access to — only PROJECT_PROGRESS.md's
// *description* of its gaps does. Per the Source Verification Rule,
// this file is therefore a fresh build against real, pasted source for
// File 70/72/73/74, BaseService, DocumentService, and app-error.ts —
// NOT an amendment/diff against recovered prior code.
//
// ONE EXCEPTION, flagged rather than silently assumed: the
// createExtraction()/runExtraction() method split and the
// "domain-specific provider error -> user-safe message -> markFailed;
// anything else -> best-effort markFailed (swallow secondary failure)
// -> rethrow original" error-handling shape are both mirrored from
// document-analysis.service.ts's (File 65) DOCUMENTED pattern, per the
// continuation prompt and PROJECT_PROGRESS.md — File 65's actual raw
// source has not been re-pasted into this conversation and so has not
// been independently re-verified here. If File 65 is ever re-pasted,
// this file's shape should be diffed against it for real.

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { BaseService } from '@/core/services/base.service';
import type { DocumentService } from '@/modules/documents/document.service';

import type { OCRExtraction } from './ocr-extraction.entity';
import type { OCRExtractionRepository } from './ocr-extraction.repository';
import { ocrExtractionResultSchema } from './ocr.schemas';
import { OCRProviderError, type OCRProvider } from './ocr-provider.interface';

/**
 * OCR module's Service layer.
 *
 * Orchestrates OCRExtractionRepository (File 74), an injected
 * OCRProvider (File 70/71), and DocumentService (File 48) behind
 * BaseService's authorization primitives (File 23).
 *
 * KEY DECISION — depends on DocumentService directly, not a
 * DocumentRepository. This replaces the earlier session's placeholder
 * OCRDocumentSource interface. Two of DocumentService's real methods
 * are used: getDocumentById() (for owner_id, at createExtraction time,
 * and mime_type, at runExtraction time) and getDownloadUrl() (for the
 * signed URL an OCRProvider fetches bytes from). Depending on the real
 * service rather than redefining a narrower interface means OCR
 * automatically inherits DocumentService's own soft-delete and
 * RLS-visibility rules instead of this module quietly re-implementing
 * a second, possibly-drifting copy of them.
 *
 * KEY DECISION — starting an extraction is treated as a write-like
 * action requiring an explicit ownership check on top of RLS, even
 * though DocumentService's own *reads* (getDocumentById,
 * getDownloadUrl) deliberately do NOT call requireOwnership()
 * themselves (see that file's class-level doc comment: read visibility
 * is RLS-governed only). The two are not in tension: DocumentService's
 * choice is specifically about *reading* a document; OCRService calling
 * requireOwnership() afterward is about *this module's own* action
 * (spending real OCR-provider cost), which is a different decision
 * belonging to a different layer. No requireOwnership({ allowRoles:
 * ['admin'] }) override — mirrors DocumentService's writes (see its
 * KEY DECISION on updateDocument/deleteDocument): ocr_extractions'
 * real INSERT RLS policy has not been independently verified either
 * way this session, so granting a service-layer admin override with no
 * confirmed RLS to back it up risks the same "confusing DatabaseError
 * instead of a clean 403" failure mode that file already documents.
 * Revisit if ocr_extractions ever gets a real admin RLS policy.
 *
 * KEY DECISION — reuses documents.schemas.ts's documentIdParamSchema
 * for parsing a raw `{ id }`-shaped param, the same schema
 * DocumentService's own methods already parse against. This is an
 * import of an already-proven contract (document.service.ts, verified
 * real source, already relies on it), not a redefinition of it — kept
 * as one canonical "how do we validate a document id param" schema
 * rather than OCR growing a parallel, possibly-drifting copy.
 */
export class OCRService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly ocrExtractionRepository: OCRExtractionRepository,
    private readonly ocrProvider: OCRProvider,
    private readonly documentService: DocumentService,
  ) {
    super(currentUser);
  }

  /**
   * Fast path. Creates a 'pending' extraction row and returns
   * immediately — mirrors File 65's documented createAnalysis()/
   * runAnalysis() split, so the Route Handler layer (File 76+) decides
   * whether to await runExtraction() or fire-and-forget it, the same
   * decision item 6 of PROJECT_PROGRESS.md's NEXT STEP still has open.
   *
   * rawParams is expected to be `{ id: <document id> }` — the same
   * shape documentIdParamSchema already validates for DocumentService's
   * own methods (typically sourced from a route's dynamic segment, e.g.
   * POST /api/documents/[id]/ocr).
   */
  async createExtraction(rawParams: unknown): Promise<OCRExtraction> {
    this.requireAuthentication();

    // getDocumentById() internally re-validates rawParams against the
    // same documentIdParamSchema, enforces RLS-visibility, and enforces
    // the soft-delete rule (a deleted document is NotFoundError even
    // for its owner) — duplicating that fetch here rather than trusting
    // a separately-parsed id is deliberate, same reasoning
    // DocumentService.getDownloadUrl() itself already documents for not
    // delegating to getDocumentById().
    const document = await this.documentService.getDocumentById(rawParams);

    this.requireOwnership(document.owner_id);

    return this.ocrExtractionRepository.create({
      document_id: document.id,
    });
  }

  /**
   * Slow path. Does the real work: resolves a signed URL + MIME type
   * for the extraction's document, invokes the injected OCRProvider,
   * and persists the outcome.
   *
   * Re-checks auth + ownership independently rather than trusting that
   * createExtraction() already checked them — createExtraction() and
   * runExtraction() may run in different invocations (e.g. fire-and-
   * forget from a route, or a future queue worker per
   * PROJECT_PROGRESS.md's still-open Known Architectural Gap #2), so
   * this method cannot assume the caller re-derived the same
   * authorization context.
   */
  async runExtraction(extractionId: string): Promise<OCRExtraction> {
    this.requireAuthentication();

    const extraction = await this.ocrExtractionRepository.findByIdOrThrow(extractionId);
    const documentParams = { id: extraction.document_id };

    const document = await this.documentService.getDocumentById(documentParams);
    this.requireOwnership(document.owner_id);

    await this.ocrExtractionRepository.markProcessing(extraction.id);

    try {
      const fileUrl = await this.documentService.getDownloadUrl(documentParams);

      const result = await this.ocrProvider.extractText({
        fileUrl,
        mimeType: document.mime_type,
      });

      // Validated against ocrExtractionResultSchema (File 72) at this
      // boundary, not just cast — the same "narrower persisted shape,
      // validated at the boundary" reasoning ocr.schemas.ts's own
      // header comment already gives for why this schema is distinct
      // from OCRExtractionResult (File 70). pageCount defaults to 0
      // when a provider doesn't report one (OCRExtractionResult.pageCount
      // is optional; the persisted schema requires a nonnegative int) —
      // flagged as a new decision, not one carried over from any prior
      // source.
      const validatedResult = ocrExtractionResultSchema.parse({
        text: result.text,
        pageCount: result.pageCount ?? 0,
        confidence: result.confidence,
      });

      return await this.ocrExtractionRepository.markCompleted(
        extraction.id,
        validatedResult,
        result.provider,
      );
    } catch (error) {
      if (error instanceof OCRProviderError) {
        return await this.ocrExtractionRepository.markFailed(
          extraction.id,
          this.toUserSafeMessage(error),
        );
      }

      // Non-domain failure — e.g. the document was deleted between
      // createExtraction() and runExtraction(), getDownloadUrl() threw,
      // or ocrExtractionResultSchema.parse() rejected a malformed
      // provider response. Best-effort markFailed, swallowing any
      // secondary failure so it doesn't mask the original, then
      // rethrow. Mirrors File 65's documented runAnalysis() shape (see
      // this file's header provenance note — mirrored from
      // description, not re-verified against File 65's raw source this
      // session).
      try {
        await this.ocrExtractionRepository.markFailed(
          extraction.id,
          'OCR extraction failed unexpectedly. Please try again.',
        );
      } catch {
        // Deliberately swallowed — see comment above.
      }

      throw error;
    }
  }

  /**
   * AMENDMENT — new. Returns the most recent COMPLETED extraction for a
   * document, or null if none exists. Added for the Clause Classification
   * module (File 98's route), which depends on already-extracted text
   * for a document that was OCR'd and analyzed in an earlier, separate
   * request — unlike document-analysis's route (File 67), which always
   * creates and runs a fresh extraction inline in the same request and
   * so never previously needed a read-back path.
   *
   * Deliberately filters to status === 'completed' with a non-null
   * result, not just "the most recent row" — findByDocumentId() orders
   * by created_at desc, but the most recent attempt could be a failed
   * retry that happened after an earlier successful extraction. Callers
   * of this method want usable text, not merely the latest attempt
   * regardless of outcome.
   *
   * No requireOwnership() — this is a read, following the same
   * RLS-only-for-reads convention every other read method in this class
   * (and DocumentService's own reads) already establishes. Only
   * createExtraction() (a write with real OCR-provider cost) requires
   * explicit ownership on top of RLS.
   */
  async getLatestCompletedExtractionForDocument(rawParams: unknown): Promise<OCRExtraction | null> {
    this.requireAuthentication();

    const document = await this.documentService.getDocumentById(rawParams);

    const extractions = await this.ocrExtractionRepository.findByDocumentId(document.id);

    return extractions.find((e) => e.status === 'completed' && e.result !== null) ?? null;
  }

  /**
   * Translates an OCRProviderError's category into a user-safe message,
   * mirroring document_analyses' USER_SAFE_FAILURE_MESSAGES convention
   * (File 65, per its documented shape) — kept as a private method here
   * rather than a module-level constant map, since OCR currently only
   * has two categories versus AIProviderError's five-way ErrorCode
   * split; revisit if OCR's failure taxonomy grows to justify the same
   * table-based approach.
   */
  private toUserSafeMessage(error: OCRProviderError): string {
    switch (error.category) {
      case 'transient':
        return 'The document could not be processed right now. Please try again shortly.';
      case 'permanent':
        return 'This document could not be processed — the file may be corrupted, password-protected, or in an unsupported format.';
      default:
        return 'The document could not be processed.';
    }
  }
}