// src/modules/risk-detection/risk-detection.service.ts
// File 104 — JurisAI Risk Detection module

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AIProviderError, ErrorCode, NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import { generateWithFallback } from '@/core/ai/ai-provider.factory';
import type { DocumentService } from '@/modules/documents/document.service';
import type { DocumentAnalysisService } from '@/modules/document-analysis/document-analysis.service';
import type { ClauseClassificationService } from '@/modules/clause-classification/clause-classification.service';
import type { ClassifiedClause } from '@/modules/clause-classification/clause-classification.schemas';

import { riskDetectionResultSchema } from './risk-detection.schemas';
import type { RiskDetectionRepository } from './risk-detection.repository';
import type { RiskDetection } from './risk-detection.entity';

/**
 * User-safe fallback messages per AIProviderError code. Same convention
 * as document-analysis.service.ts and clause-classification.service.ts —
 * errorMessage persisted via markFailed() is expected to be safe to
 * eventually show a customer, never a raw SDK/provider error string.
 */
const USER_SAFE_FAILURE_MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.AI_PROVIDER_CONTENT_REJECTED]:
    'This document could not be checked for risks — it may have been flagged by content safety checks.',
  [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]:
    'Risk detection could not be completed due to an unexpected error. Please try again.',
  [ErrorCode.AI_PROVIDER_TIMEOUT]: 'Risk detection timed out. Please try again.',
  [ErrorCode.AI_PROVIDER_RATE_LIMITED]:
    'Risk detection service is temporarily busy. Please try again shortly.',
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]:
    'Risk detection service is temporarily unavailable. Please try again shortly.',
};

const GENERIC_FAILURE_MESSAGE =
  'Risk detection failed due to an unexpected error. Please try again.';

/**
 * Service layer for the Risk Detection Engine (File 101's schema, File
 * 100's table, File 103's repository). Second module in the Phase 2
 * pipeline (Clause Classification -> Risk Detection -> Missing Clause
 * Detection -> Compliance Detection -> Health Score).
 *
 * KEY DECISION — depends on THREE services, not two:
 * DocumentAnalysisService, DocumentService, AND ClauseClassificationService.
 * ClauseClassificationService's own class-level note already establishes
 * why DocumentAnalysisService alone isn't enough (requireOwnership()
 * needs owner_id, which getAnalysisById() doesn't expose). Risk
 * Detection adds a third dependency for a different reason entirely: per
 * the constitution's roadmap, this module consumes BOTH Document
 * Analysis output AND Clause Classification output — the latter via
 * ClauseClassificationService#getLatestCompletedClassificationForAnalysis()
 * (Amendment #2, added specifically to unblock this dependency, mirroring
 * OCRService's identical role for File 98). Fetching it through the
 * Service layer, not RiskDetectionRepository reaching into
 * clause_classifications directly, keeps Clause Classification's module
 * boundary intact — the same discipline that led to
 * getLatestCompletedExtractionForDocument() existing in the first place.
 *
 * KEY DECISION — runRiskDetection() takes documentText AND
 * classifiedClauses as explicit parameters, not just documentText.
 * Extends ClauseClassificationService's own "documentText is explicit,
 * not derived internally" reasoning one step further: this service's job
 * is "take text plus a clause breakdown, produce risk flags" — it stays
 * ignorant of how either input was produced or fetched. The Route layer
 * decides what "latest completed classification" means operationally
 * (e.g. what happens if none exists yet), not this service.
 *
 * KEY DECISION — ownership gates starting a risk detection run, same as
 * ClauseClassificationService#createClassification and
 * DocumentAnalysisService#createAnalysis: a new row + real AI provider
 * cost is write-like in consequence, not just a read.
 *
 * KEY DECISION — split into createRiskDetection() (fast, returns a
 * pending row) and runRiskDetection() (slow — the actual AI call).
 * Identical reasoning to both upstream services: whether the HTTP layer
 * awaits runRiskDetection() before responding, or fires it without
 * awaiting, is a Route Handler decision this service should not make.
 */
export class RiskDetectionService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly riskDetectionRepository: RiskDetectionRepository,
    private readonly analysisService: DocumentAnalysisService,
    private readonly documentService: DocumentService,
    private readonly classificationService: ClauseClassificationService,
  ) {
    super(currentUser);
  }

  /**
   * Validates the target analysis (via analysisService.getAnalysisById —
   * document visibility + analysis-belongs-to-document check), requires
   * ownership of the parent document (fetched directly via
   * documentService, since analysisService does not expose it), then
   * creates a 'pending' risk_detections row and returns it immediately.
   * Does NOT call the AI provider — see class-level note.
   *
   * Does NOT check for a completed classification here — same division
   * of responsibility as createClassification() not checking for
   * completed OCR: creating the row is cheap and reversible, so the
   * "is there anything usable to run against yet" check belongs at
   * runRiskDetection() time (or the Route layer), not here.
   */
  async createRiskDetection(rawParams: unknown, analysisId: string): Promise<RiskDetection> {
    this.requireAuthentication();

    // Fetched directly for its owner_id — analysisService.getAnalysisById
    // below performs its own equivalent document fetch internally, but
    // does not return the document itself. Same deliberate duplication
    // as ClauseClassificationService#createClassification.
    const document = await this.documentService.getDocumentById(rawParams);

    // No admin override — mirrors createClassification()/createAnalysis()
    // exactly: starting a risk detection run spends real AI cost, so
    // ownership (not just RLS visibility) gates it.
    this.requireOwnership(document.owner_id);

    // Confirms the analysis exists, is visible to this caller, and
    // actually belongs to the document identified by rawParams —
    // throws NotFoundError otherwise.
    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    // KNOWN FLAGGED MISMATCH, same idiom as the two upstream services:
    // CreateRiskDetectionInput ({ document_analysis_id }) is narrower
    // than the inherited create()'s Database-derived Insert type. Cast
    // follows BaseRepository's own established `as never` pattern for
    // this exact situation.
    const riskDetection = await this.riskDetectionRepository.create({
      document_analysis_id: analysis.id,
    } as never);

    return riskDetection as RiskDetection;
  }

  /**
   * Lists all risk detection runs for a given analysis, most recent
   * first. Mirrors listClassificationsForAnalysis()'s reasoning exactly:
   * re-validates the analysis first rather than trusting risk_detections'
   * own RLS join alone, so an invisible or cross-document analysisId
   * surfaces as an explicit NotFoundError, not a silently empty list.
   *
   * No requireOwnership() here, unlike createRiskDetection() — reads
   * follow the same RLS-only-for-reads convention.
   */
  async listRiskDetectionsForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<RiskDetection[]> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    return this.riskDetectionRepository.findByDocumentAnalysisId(analysis.id);
  }

  /**
   * Fetches a single risk detection run, scoped to an analysis the
   * caller can see. Mirrors getClassificationById()'s pattern exactly,
   * one module further down the pipeline: re-validate the parent (the
   * analysis) first, then verify the fetched risk detection's
   * document_analysis_id actually matches it — a real but
   * differently-owned-or-scoped riskDetectionId must 404, not leak
   * cross-analysis data.
   *
   * No requireOwnership() — same reasoning as
   * listRiskDetectionsForAnalysis: this is a read.
   */
  async getRiskDetectionById(
    rawParams: unknown,
    analysisId: string,
    riskDetectionId: string,
  ): Promise<RiskDetection> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const riskDetection = await this.riskDetectionRepository.findByIdOrThrow(riskDetectionId);

    if (riskDetection.document_analysis_id !== analysis.id) {
      // Deliberately identical in shape to "risk detection doesn't
      // exist" — same reasoning as getClassificationById()'s equivalent
      // check: do not let a caller distinguish "wrong analysis" from
      // "no such risk detection at all" for a pair they don't have
      // access to.
      throw new NotFoundError('risk_detections', riskDetectionId);
    }

    return riskDetection;
  }

  /**
   * Returns the most recent 'completed' classification for the given
   * analysis, via ClauseClassificationService (Amendment #2) — the read
   * the Route layer is expected to call BEFORE runRiskDetection(), to
   * decide what to do if Clause Classification hasn't completed yet for
   * this analysis. Exposed here (rather than requiring the Route layer
   * to construct ClauseClassificationService itself via its own factory)
   * so the Route only needs to build RiskDetectionFactory's single
   * service, matching File 98's own preference for keeping Route-layer
   * service construction minimal where reasonably possible — though
   * note File 98 itself still constructs OCRService directly, so this is
   * a convenience passthrough, not a hard rule this service invents.
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
   * AMENDMENT #3 (File 104) — added to unblock the AI Recommendation
   * Engine (File 128), which needs its own latest-completed-result read
   * exposed the same way getLatestCompletedClassificationForAnalysis()
   * already exposes ClauseClassificationService's. Mirrors that method's
   * shape exactly, in the opposite direction: this is Risk Detection
   * exposing ITS OWN latest completed result to a sibling downstream
   * module, not fetching an upstream input.
   *
   * FLAGGED ASSUMPTION: riskDetectionRepository.findLatestByDocumentAnalysisId
   * (File 103) returns the most recent row regardless of status —
   * pending/processing/failed included. This method explicitly filters
   * for status === 'completed' and returns null otherwise, since a
   * 'failed' or still-'processing' row has no usable result and the
   * "Completed" in this method's name would otherwise be dishonest.
   * ClauseClassificationService's own getLatestCompletedClassificationForAnalysis()
   * has not been re-verified against real source in this project to
   * confirm it filters identically — if its real source surfaces later
   * and filters differently, reconcile against it then.
   *
   * No requireOwnership() — same reasoning as getRiskDetectionById():
   * this is a read, gated by re-validating the analysis is visible to
   * the caller, not by ownership.
   */
  async getLatestCompletedRiskDetectionForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<RiskDetection | null> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const latest = await this.riskDetectionRepository.findLatestByDocumentAnalysisId(
      analysis.id,
    );

    return latest && latest.status === 'completed' ? latest : null;
  }

  /**
   * Runs the actual risk detection for an already-created 'pending' row:
   * marks it 'processing', calls generateWithFallback() against File
   * 101's schema, then marks 'completed' (with result + which provider
   * answered) or 'failed' (with a user-safe message).
   *
   * Takes both documentText and classifiedClauses explicitly — see
   * class-level KEY DECISION. classifiedClauses is expected to be the
   * `.clauses` array from a completed ClauseClassificationResult
   * (File 93), typically obtained by the Route layer via
   * getLatestCompletedClassificationForAnalysis() above.
   *
   * Never throws for an AI-provider failure — same reasoning as the two
   * upstream services: a caller invoking this without awaiting it may
   * have no way to receive a thrown error. Does rethrow for anything
   * that isn't an AIProviderError.
   */
  async runRiskDetection(
    riskDetectionId: string,
    documentText: string,
    classifiedClauses: ClassifiedClause[],
  ): Promise<RiskDetection> {
    await this.riskDetectionRepository.markProcessing(riskDetectionId);

    try {
      const { result, providerUsed } = await generateWithFallback({
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt(documentText, classifiedClauses),
        schema: riskDetectionResultSchema,
      });

      return await this.riskDetectionRepository.markCompleted(
        riskDetectionId,
        result,
        providerUsed,
      );
    } catch (error) {
      if (error instanceof AIProviderError) {
        const message = USER_SAFE_FAILURE_MESSAGES[error.code] ?? GENERIC_FAILURE_MESSAGE;
        return await this.riskDetectionRepository.markFailed(riskDetectionId, message);
      }

      // Not an AI-provider failure. Best-effort record the row as
      // failed so it doesn't sit in 'processing' forever, then rethrow —
      // identical structure to the two upstream services' secondary
      // catch, same reasoning: a failure while persisting the failure
      // state must not mask the original error.
      await this.riskDetectionRepository
        .markFailed(riskDetectionId, GENERIC_FAILURE_MESSAGE)
        .catch(() => {
          /* see comment above — original error takes priority */
        });

      throw error;
    }
  }
}

/**
 * System prompt reinforcing File 101's schema-level `.describe()`
 * instructions. Plain function, not a class method — same rationale as
 * the two upstream services' buildSystemPrompt: no dependency on `this`,
 * easier to unit test in isolation.
 */
function buildSystemPrompt(): string {
  return [
    'You are a risk detection engine for JurisAI, an AI legal operating',
    'system serving customers in India. You are given a legal document\'s',
    'full text, plus a prior exhaustive breakdown of its clauses by',
    'category, and you identify risks a document owner should be aware',
    'of before signing or relying on this document.',
    '',
    'Rules:',
    '- Use the provided clause breakdown as your primary reference for',
    '  which clauses exist and what category each belongs to — do not',
    '  re-derive clause boundaries or categories yourself; focus on risk',
    '  assessment, not re-classification.',
    '- Be exhaustive: flag every genuine risk you can identify, not just',
    '  the single most severe one. A document owner needs the full',
    '  picture.',
    '- Only flag "missing_clause" when a clause category that should',
    '  reasonably be present for this type of document is genuinely',
    '  absent from the clause breakdown — not for stylistic gaps.',
    '- When a flag applies to an existing clause, its excerpt must be',
    '  verbatim text from the document — never paraphrase, summarize, or',
    '  reconstruct clause text. Leave excerpt unset for "missing_clause"',
    '  flags, since no such text exists.',
    '- Calibrate severity consistently across documents, not relative to',
    '  "the worst issue in this particular document."',
    '- Reflect genuine uncertainty in `confidence` rather than defaulting',
    '  to a high value.',
  ].join('\n');
}

/**
 * Builds the user-turn prompt combining both inputs this service
 * depends on — see class-level KEY DECISION. The clause breakdown is
 * serialized as JSON rather than prose, since it's already
 * machine-structured data (category, excerpt, order) that the model
 * should treat as reference input, not narrative to re-read.
 */
function buildUserPrompt(documentText: string, classifiedClauses: ClassifiedClause[]): string {
  return [
    '=== DOCUMENT TEXT ===',
    documentText,
    '',
    '=== CLAUSE BREAKDOWN (from prior classification) ===',
    JSON.stringify(classifiedClauses, null, 2),
  ].join('\n');
}