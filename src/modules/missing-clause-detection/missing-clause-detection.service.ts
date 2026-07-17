// src/modules/missing-clause-detection/missing-clause-detection.service.ts
// File 112 — JurisAI Missing Clause Detection module

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AIProviderError, ErrorCode, NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import { generateWithFallback } from '@/core/ai/ai-provider.factory';
import type { DocumentService } from '@/modules/documents/document.service';
import type { DocumentAnalysisService } from '@/modules/document-analysis/document-analysis.service';
import type { ClauseClassificationService } from '@/modules/clause-classification/clause-classification.service';
import type { ClassifiedClause } from '@/modules/clause-classification/clause-classification.schemas';

import { missingClauseDetectionResultSchema } from './missing-clause-detection.schemas';
import type { MissingClauseDetectionRepository } from './missing-clause-detection.repository';
import type { MissingClauseDetection } from './missing-clause-detection.entity';

/**
 * User-safe fallback messages per AIProviderError code. Same convention
 * as risk-detection.service.ts and clause-classification.service.ts —
 * errorMessage persisted via markFailed() is expected to be safe to
 * eventually show a customer, never a raw SDK/provider error string.
 */
const USER_SAFE_FAILURE_MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.AI_PROVIDER_CONTENT_REJECTED]:
    'This document could not be checked for missing clauses — it may have been flagged by content safety checks.',
  [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]:
    'Missing clause detection could not be completed due to an unexpected error. Please try again.',
  [ErrorCode.AI_PROVIDER_TIMEOUT]: 'Missing clause detection timed out. Please try again.',
  [ErrorCode.AI_PROVIDER_RATE_LIMITED]:
    'Missing clause detection service is temporarily busy. Please try again shortly.',
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]:
    'Missing clause detection service is temporarily unavailable. Please try again shortly.',
};

const GENERIC_FAILURE_MESSAGE =
  'Missing clause detection failed due to an unexpected error. Please try again.';

/**
 * Service layer for the Missing Clause Detection module (File 109's
 * schema, File 108's table, File 111's repository). Third module in the
 * Phase 2 pipeline (Clause Classification -> Risk Detection -> Missing
 * Clause Detection -> Compliance Detection -> Health Score).
 *
 * KEY DECISION — depends on THREE services, not two, same shape as
 * RiskDetectionService: DocumentAnalysisService, DocumentService, AND
 * ClauseClassificationService. Unlike Risk Detection, this module's own
 * schema (File 109) never needs a verbatim clause excerpt — but it still
 * needs the full document TEXT, not just the clause breakdown, for a
 * reason specific to this module: determining what clauses are "missing"
 * requires first inferring what TYPE of document this is (a lease vs an
 * NDA vs a loan agreement expect entirely different clause sets), and
 * that context lives in the document's actual text (title, preamble,
 * party-role language) — not reliably in a list of found category
 * labels alone. Dropping DocumentAnalysisService's text-fetch role here,
 * the way this module's own schema might suggest at first glance, would
 * make missing-clause detection strictly worse at its one job for a
 * marginal payload-size saving. Fetching classified clauses via
 * ClauseClassificationService#getLatestCompletedClassificationForAnalysis()
 * (the same Amendment #2 RiskDetectionService itself depends on) keeps
 * Clause Classification's module boundary intact here too.
 *
 * KEY DECISION — runMissingClauseDetection() takes documentText AND
 * classifiedClauses as explicit parameters, identical shape to
 * RiskDetectionService#runRiskDetection(). This service stays ignorant
 * of how either input was produced or fetched; the Route layer decides
 * what "latest completed classification" means operationally.
 *
 * KEY DECISION — ownership gates starting a missing clause detection
 * run, same as RiskDetectionService#createRiskDetection: a new row +
 * real AI provider cost is write-like in consequence, not just a read.
 *
 * KEY DECISION — split into createMissingClauseDetection() (fast,
 * returns a pending row) and runMissingClauseDetection() (slow — the
 * actual AI call). Identical reasoning to every upstream service:
 * whether the HTTP layer awaits runMissingClauseDetection() before
 * responding, or fires it without awaiting, is a Route Handler decision
 * this service should not make.
 */
export class MissingClauseDetectionService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly missingClauseDetectionRepository: MissingClauseDetectionRepository,
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
   * creates a 'pending' missing_clause_detections row and returns it
   * immediately. Does NOT call the AI provider — see class-level note.
   *
   * Does NOT check for a completed classification here — same division
   * of responsibility as createRiskDetection() not checking for
   * completed OCR: creating the row is cheap and reversible, so the
   * "is there anything usable to run against yet" check belongs at
   * runMissingClauseDetection() time (or the Route layer), not here.
   */
  async createMissingClauseDetection(
    rawParams: unknown,
    analysisId: string,
  ): Promise<MissingClauseDetection> {
    this.requireAuthentication();

    // Fetched directly for its owner_id — analysisService.getAnalysisById
    // below performs its own equivalent document fetch internally, but
    // does not return the document itself. Same deliberate duplication
    // as RiskDetectionService#createRiskDetection.
    const document = await this.documentService.getDocumentById(rawParams);

    // No admin override — mirrors createRiskDetection()/createClassification()
    // exactly: starting a missing clause detection run spends real AI
    // cost, so ownership (not just RLS visibility) gates it.
    this.requireOwnership(document.owner_id);

    // Confirms the analysis exists, is visible to this caller, and
    // actually belongs to the document identified by rawParams —
    // throws NotFoundError otherwise.
    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    // KNOWN FLAGGED MISMATCH, same idiom as the two upstream services:
    // CreateMissingClauseDetectionInput ({ document_analysis_id }) is
    // narrower than the inherited create()'s Database-derived Insert
    // type. Cast follows BaseRepository's own established `as never`
    // pattern for this exact situation.
    const missingClauseDetection = await this.missingClauseDetectionRepository.create({
      document_analysis_id: analysis.id,
    } as never);

    return missingClauseDetection as MissingClauseDetection;
  }

  /**
   * Lists all missing clause detection runs for a given analysis, most
   * recent first. Mirrors listRiskDetectionsForAnalysis()'s reasoning
   * exactly: re-validates the analysis first rather than trusting
   * missing_clause_detections' own RLS join alone, so an invisible or
   * cross-document analysisId surfaces as an explicit NotFoundError, not
   * a silently empty list.
   *
   * No requireOwnership() here, unlike createMissingClauseDetection() —
   * reads follow the same RLS-only-for-reads convention.
   */
  async listMissingClauseDetectionsForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<MissingClauseDetection[]> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    return this.missingClauseDetectionRepository.findByDocumentAnalysisId(analysis.id);
  }

  /**
   * Fetches a single missing clause detection run, scoped to an analysis
   * the caller can see. Mirrors getRiskDetectionById()'s pattern
   * exactly, one module further down the pipeline: re-validate the
   * parent (the analysis) first, then verify the fetched missing clause
   * detection's document_analysis_id actually matches it — a real but
   * differently-owned-or-scoped missingClauseDetectionId must 404, not
   * leak cross-analysis data.
   *
   * No requireOwnership() — same reasoning as
   * listMissingClauseDetectionsForAnalysis: this is a read.
   */
  async getMissingClauseDetectionById(
    rawParams: unknown,
    analysisId: string,
    missingClauseDetectionId: string,
  ): Promise<MissingClauseDetection> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const missingClauseDetection =
      await this.missingClauseDetectionRepository.findByIdOrThrow(missingClauseDetectionId);

    if (missingClauseDetection.document_analysis_id !== analysis.id) {
      // Deliberately identical in shape to "missing clause detection
      // doesn't exist" — same reasoning as getRiskDetectionById()'s
      // equivalent check: do not let a caller distinguish "wrong
      // analysis" from "no such missing clause detection at all" for a
      // pair they don't have access to.
      throw new NotFoundError('missing_clause_detections', missingClauseDetectionId);
    }

    return missingClauseDetection;
  }

  /**
   * Returns the most recent 'completed' classification for the given
   * analysis, via ClauseClassificationService (Amendment #2) — the read
   * the Route layer is expected to call BEFORE runMissingClauseDetection(),
   * to decide what to do if Clause Classification hasn't completed yet
   * for this analysis. Exposed here for the same convenience-passthrough
   * reason as RiskDetectionService's identical method — so the Route
   * only needs to build this module's own Factory-resolved service, not
   * construct ClauseClassificationService itself.
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
   * AMENDMENT #3 (File 112) — added to unblock the AI Recommendation
   * Engine (File 125), which needs its own latest-completed-result read
   * exposed the same way getLatestCompletedClassificationForAnalysis()
   * already exposes ClauseClassificationService's. Mirrors that method's
   * shape exactly, in the opposite direction: this is Missing Clause
   * Detection exposing ITS OWN latest completed result to a sibling
   * downstream module, not fetching an upstream input. Identical
   * amendment to RiskDetectionService's Amendment #3 (File 104) and
   * ComplianceDetectionService's Amendment #3 (File 120), applied here
   * for the same reason — this file was the one upstream module missing
   * it, discovered when scoping the AI Recommendation Service's
   * dependencies.
   *
   * FLAGGED ASSUMPTION: missingClauseDetectionRepository.findLatestByDocumentAnalysisId
   * (File 111) returns the most recent row regardless of status —
   * pending/processing/failed included. This method explicitly filters
   * for status === 'completed' and returns null otherwise, since a
   * 'failed' or still-'processing' row has no usable result. Same
   * reasoning as RiskDetectionService's and ComplianceDetectionService's
   * identical amendments.
   *
   * No requireOwnership() — same reasoning as getMissingClauseDetectionById():
   * this is a read, gated by re-validating the analysis is visible to
   * the caller, not by ownership.
   */
  async getLatestCompletedMissingClauseDetectionForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<MissingClauseDetection | null> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const latest = await this.missingClauseDetectionRepository.findLatestByDocumentAnalysisId(
      analysis.id,
    );

    return latest && latest.status === 'completed' ? latest : null;
  }

  /**
   * Runs the actual missing clause detection for an already-created
   * 'pending' row: marks it 'processing', calls generateWithFallback()
   * against File 109's schema, then marks 'completed' (with result +
   * which provider answered) or 'failed' (with a user-safe message).
   *
   * Takes both documentText and classifiedClauses explicitly — see
   * class-level KEY DECISION on why documentText is still required here
   * despite this module's schema never needing a verbatim excerpt.
   * classifiedClauses is expected to be the `.clauses` array from a
   * completed ClauseClassificationResult (File 93), typically obtained
   * by the Route layer via getLatestCompletedClassificationForAnalysis()
   * above.
   *
   * Never throws for an AI-provider failure — same reasoning as every
   * upstream service: a caller invoking this without awaiting it may
   * have no way to receive a thrown error. Does rethrow for anything
   * that isn't an AIProviderError.
   */
  async runMissingClauseDetection(
    missingClauseDetectionId: string,
    documentText: string,
    classifiedClauses: ClassifiedClause[],
  ): Promise<MissingClauseDetection> {
    await this.missingClauseDetectionRepository.markProcessing(missingClauseDetectionId);

    try {
      const { result, providerUsed } = await generateWithFallback({
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt(documentText, classifiedClauses),
        schema: missingClauseDetectionResultSchema,
      });

      return await this.missingClauseDetectionRepository.markCompleted(
        missingClauseDetectionId,
        result,
        providerUsed,
      );
    } catch (error) {
      if (error instanceof AIProviderError) {
        const message = USER_SAFE_FAILURE_MESSAGES[error.code] ?? GENERIC_FAILURE_MESSAGE;
        return await this.missingClauseDetectionRepository.markFailed(
          missingClauseDetectionId,
          message,
        );
      }

      // Not an AI-provider failure. Best-effort record the row as
      // failed so it doesn't sit in 'processing' forever, then rethrow —
      // identical structure to every upstream service's secondary
      // catch, same reasoning: a failure while persisting the failure
      // state must not mask the original error.
      await this.missingClauseDetectionRepository
        .markFailed(missingClauseDetectionId, GENERIC_FAILURE_MESSAGE)
        .catch(() => {
          /* see comment above — original error takes priority */
        });

      throw error;
    }
  }
}

/**
 * System prompt reinforcing File 109's schema-level `.describe()`
 * instructions. Plain function, not a class method — same rationale as
 * every upstream service's buildSystemPrompt: no dependency on `this`,
 * easier to unit test in isolation.
 */
function buildSystemPrompt(): string {
  return [
    'You are a missing clause detection engine for JurisAI, an AI legal',
    'operating system serving customers in India. You are given a legal',
    "document's full text, plus a prior exhaustive breakdown of its",
    'existing clauses by category, and you identify clause categories',
    'that SHOULD reasonably be present for this type of document but are',
    'absent from it.',
    '',
    'Rules:',
    '- First infer what type of document this is from its actual text —',
    '  a lease, an NDA, a loan agreement, an employment contract, etc. —',
    '  since the set of clauses that is "normally expected" is entirely',
    '  dependent on document type.',
    '- Use the provided clause breakdown as your reference for which',
    '  categories already exist in the document — do not re-derive or',
    "  re-classify the document's existing clauses yourself; focus only",
    '  on identifying genuine absences.',
    '- Only flag a category as missing when its absence is genuinely',
    '  notable for this specific document type — not for stylistic or',
    '  optional clauses that many valid documents of this type simply',
    '  omit.',
    '- Be exhaustive: flag every genuinely expected-but-absent category',
    '  you can identify, not just the single most important one. A',
    '  document owner needs the full picture.',
    '- Calibrate importance consistently across documents, not relative',
    '  to "the most notable gap in this particular document."',
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