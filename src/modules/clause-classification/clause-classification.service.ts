// src/modules/clause-classification/clause-classification.service.ts
// File 96 — JurisAI Clause Classification module

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AIProviderError, ErrorCode, NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import { generateWithFallback } from '@/core/ai/ai-provider.factory';
import type { DocumentService } from '@/modules/documents/document.service';
import type { DocumentAnalysisService } from '@/modules/document-analysis/document-analysis.service';

import { clauseClassificationResultSchema } from './clause-classification.schemas';
import type { ClauseClassificationRepository } from './clause-classification.repository';
import type { ClauseClassification } from './clause-classification.entity';

/**
 * User-safe fallback messages per AIProviderError code. Same convention
 * as document-analysis.service.ts — errorMessage persisted via
 * markFailed() is expected to be safe to eventually show a customer,
 * never a raw SDK/provider error string.
 */
const USER_SAFE_FAILURE_MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.AI_PROVIDER_CONTENT_REJECTED]:
    'This document could not be classified — it may have been flagged by content safety checks.',
  [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]:
    'Clause classification could not be completed due to an unexpected error. Please try again.',
  [ErrorCode.AI_PROVIDER_TIMEOUT]: 'Clause classification timed out. Please try again.',
  [ErrorCode.AI_PROVIDER_RATE_LIMITED]:
    'Classification service is temporarily busy. Please try again shortly.',
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]:
    'Classification service is temporarily unavailable. Please try again shortly.',
};

const GENERIC_FAILURE_MESSAGE =
  'Clause classification failed due to an unexpected error. Please try again.';

/**
 * Service layer for the Clause Classification Engine (File 93's schema,
 * File 92's table, File 95's repository). First module in the Phase 2
 * pipeline (Clause Classification -> Risk Detection -> Missing Clause
 * Detection -> Compliance Detection -> Health Score).
 *
 * KEY DECISION — documentText is an explicit parameter to runClassification(),
 * not derived from documentAnalysis.result. Same reasoning as
 * DocumentAnalysisService's identical decision for OCR text: this
 * service's job is "take text, produce classified clauses" — it stays
 * ignorant of how the text was produced, and does not assume
 * documentAnalysis.result.keyClauses (a curated subset — see File 93's
 * schema comment) is a substitute for the full document text an
 * exhaustive classification pass actually needs.
 *
 * KEY DECISION — depends on BOTH DocumentAnalysisService and
 * DocumentService, not DocumentAnalysisService alone. See this file's
 * chat message for the full reasoning: requireOwnership() needs the
 * document's owner_id directly, which DocumentAnalysisService's public
 * interface (getAnalysisById) does not expose — so DocumentService is
 * queried directly for that, alongside (not instead of)
 * DocumentAnalysisService's own visibility + analysis-ownership check.
 *
 * KEY DECISION — ownership gates starting a classification, same as
 * DocumentAnalysisService#createAnalysis: a new row + real AI provider
 * cost is write-like in consequence, not just a read.
 *
 * KEY DECISION — split into createClassification() (fast, returns a
 * pending row) and runClassification() (slow — the actual AI call).
 * Identical reasoning to DocumentAnalysisService: whether the HTTP layer
 * awaits runClassification() before responding, or fires it without
 * awaiting, is a Route Handler decision this service should not make.
 */
export class ClauseClassificationService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly classificationRepository: ClauseClassificationRepository,
    private readonly analysisService: DocumentAnalysisService,
    private readonly documentService: DocumentService,
  ) {
    super(currentUser);
  }

  /**
   * Validates the target analysis (via analysisService.getAnalysisById —
   * document visibility + analysis-belongs-to-document check), requires
   * ownership of the parent document (fetched directly via
   * documentService, since analysisService does not expose it), then
   * creates a 'pending' clause_classifications row and returns it
   * immediately. Does NOT call the AI provider — see class-level note.
   */
  async createClassification(rawParams: unknown, analysisId: string): Promise<ClauseClassification> {
    this.requireAuthentication();

    // Fetched directly for its owner_id — analysisService.getAnalysisById
    // below performs its own equivalent document fetch internally, but
    // does not return the document itself. See class-level note on this
    // deliberate duplication.
    const document = await this.documentService.getDocumentById(rawParams);

    // No admin override — mirrors DocumentAnalysisService#createAnalysis
    // exactly: starting a classification run spends real AI cost, so
    // ownership (not just RLS visibility) gates it.
    this.requireOwnership(document.owner_id);

    // Confirms the analysis exists, is visible to this caller, and
    // actually belongs to the document identified by rawParams —
    // throws NotFoundError otherwise (see getAnalysisById's own
    // documented cross-document 404 behavior).
    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    // KNOWN FLAGGED MISMATCH, same idiom as DocumentAnalysisService#createAnalysis:
    // CreateClauseClassificationInput ({ document_analysis_id }) is
    // narrower than the inherited create()'s Database-derived Insert
    // type. Cast follows BaseRepository's own established `as never`
    // pattern for this exact situation.
    const classification = await this.classificationRepository.create({
      document_analysis_id: analysis.id,
    } as never);

    return classification as ClauseClassification;
  }

  /**
   * Lists all classification runs for a given analysis, most recent
   * first. Mirrors DocumentAnalysisService#listAnalysesForDocument's
   * reasoning: re-validates the analysis via analysisService.getAnalysisById
   * first rather than trusting clause_classifications' own RLS join
   * alone, so an invisible or cross-document analysisId surfaces as an
   * explicit NotFoundError, not a silently empty list.
   *
   * No requireOwnership() here, unlike createClassification() — reads
   * follow the same RLS-only-for-reads convention; only starting a run
   * was treated as write-like enough to need an explicit ownership
   * check on top of RLS.
   */
  async listClassificationsForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<ClauseClassification[]> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    return this.classificationRepository.findByDocumentAnalysisId(analysis.id);
  }

  /**
   * Fetches a single classification run, scoped to an analysis the
   * caller can see. Mirrors DocumentAnalysisService#getAnalysisById's
   * pattern, one layer further down the pipeline: re-validate the
   * parent (here, the analysis, via analysisService.getAnalysisById)
   * first, then verify the fetched classification's
   * document_analysis_id actually matches it — a real but
   * differently-owned-or-scoped classificationId must 404, not leak
   * cross-analysis data, same reasoning as the document_id check in
   * DocumentAnalysisService#getAnalysisById.
   *
   * No requireOwnership() — same reasoning as
   * listClassificationsForAnalysis: this is a read.
   */
  async getClassificationById(
    rawParams: unknown,
    analysisId: string,
    classificationId: string,
  ): Promise<ClauseClassification> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const classification = await this.classificationRepository.findByIdOrThrow(classificationId);

    if (classification.document_analysis_id !== analysis.id) {
      // Deliberately identical in shape to "classification doesn't
      // exist" — same reasoning as DocumentAnalysisService#getAnalysisById's
      // equivalent check: do not let a caller distinguish "wrong
      // analysis" from "no such classification at all" for a pair they
      // don't have access to.
      throw new NotFoundError('clause_classifications', classificationId);
    }

    return classification;
  }

  /**
   * AMENDMENT #2: new. Returns the most recent 'completed' classification
   * run for a given analysis, or null if none exists yet — the read
   * downstream Phase 2 modules (starting with Risk Detection) are
   * expected to use to consume this module's output, the same role
   * OCRService#getLatestCompletedExtractionForDocument() plays for OCR
   * output being consumed by Document Analysis and this module itself.
   *
   * Deliberately filters to status = 'completed' at this layer rather
   * than delegating to
   * classificationRepository.findLatestByDocumentAnalysisId() (which
   * returns the latest row regardless of status) — same reasoning as
   * OCRService's equivalent method: a caller asking "what should I run
   * risk detection against" needs a usable result, not the latest
   * attempt regardless of whether it succeeded. A 'pending', 'processing',
   * or 'failed' latest row must not silently masquerade as usable data,
   * nor should its mere existence force every caller to separately
   * re-derive "was the latest one actually completed" for itself.
   *
   * Re-validates the analysis via getAnalysisById() first, identical to
   * every other read on this service, so an invisible or cross-document
   * analysisId surfaces as NotFoundError rather than a misleading null.
   *
   * No requireOwnership() — same reasoning as every other read method on
   * this service: this is a read, RLS-only convention applies.
   */
  async getLatestCompletedClassificationForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<ClauseClassification | null> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const classifications = await this.classificationRepository.findByDocumentAnalysisId(
      analysis.id,
    );

    return classifications.find((classification) => classification.status === 'completed') ?? null;
  }

  /**
   * Runs the actual classification for an already-created 'pending' row:
   * marks it 'processing', calls generateWithFallback() against File
   * 93's schema, then marks 'completed' (with result + which provider
   * answered) or 'failed' (with a user-safe message).
   *
   * Never throws for an AI-provider failure — same reasoning as
   * DocumentAnalysisService#runAnalysis: a caller invoking this without
   * awaiting it may have no way to receive a thrown error. Does rethrow
   * for anything that isn't an AIProviderError.
   */
  async runClassification(
    classificationId: string,
    documentText: string,
  ): Promise<ClauseClassification> {
    await this.classificationRepository.markProcessing(classificationId);

    try {
      const { result, providerUsed } = await generateWithFallback({
        systemPrompt: buildSystemPrompt(),
        userPrompt: documentText,
        schema: clauseClassificationResultSchema,
      });

      return await this.classificationRepository.markCompleted(
        classificationId,
        result,
        providerUsed,
      );
    } catch (error) {
      if (error instanceof AIProviderError) {
        const message = USER_SAFE_FAILURE_MESSAGES[error.code] ?? GENERIC_FAILURE_MESSAGE;
        return await this.classificationRepository.markFailed(classificationId, message);
      }

      // Not an AI-provider failure. Best-effort record the row as
      // failed so it doesn't sit in 'processing' forever, then rethrow —
      // identical structure to DocumentAnalysisService#runAnalysis's
      // secondary catch, same reasoning: a failure while persisting the
      // failure state must not mask the original error.
      await this.classificationRepository
        .markFailed(classificationId, GENERIC_FAILURE_MESSAGE)
        .catch(() => {
          /* see comment above — original error takes priority */
        });

      throw error;
    }
  }
}

/**
 * System prompt reinforcing File 93's schema-level `.describe()`
 * instructions. Plain function, not a class method — same rationale as
 * document-analysis.service.ts's buildSystemPrompt: no dependency on
 * `this`, easier to unit test in isolation.
 */
function buildSystemPrompt(): string {
  return [
    'You are a clause classification engine for JurisAI, an AI legal',
    'operating system serving customers in India. You identify and',
    'categorize every distinct clause in a legal document.',
    '',
    'Rules:',
    '- Be exhaustive: classify every clause you can identify, not just the',
    '  ones that seem most important. Downstream analysis depends on this',
    '  list being complete, not curated.',
    '- Each excerpt must be verbatim text from the document — never',
    '  paraphrase, summarize, or reconstruct clause text.',
    '- Assign the single category that best fits each clause. Use "other"',
    '  only when no listed category genuinely applies.',
    '- Preserve document order: `order` must reflect each clause\'s actual',
    '  position in the document, starting at 0.',
    '- Reflect genuine uncertainty in `confidence` rather than defaulting',
    '  to a high value — a caller downstream may use this to decide',
    '  whether a classification needs human review.',
  ].join('\n');
}